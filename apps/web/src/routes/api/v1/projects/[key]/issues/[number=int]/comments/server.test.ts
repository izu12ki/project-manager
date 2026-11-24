import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '#lib/server/authz.ts';
import type { DB } from '#lib/server/db/index.ts';
import { createApiKey } from '#lib/server/services/api-keys.ts';
import { addComment, toggleReaction } from '#lib/server/services/comments.ts';
import { createIssue, deleteIssue } from '#lib/server/services/issues.ts';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	seedProject,
	seedUser
} from '#lib/server/test-utils.ts';
import { GET, POST } from './+server';

type Comment = {
	id: string;
	author: { id: string; name: string };
	body: string;
	createdAt: string;
	updatedAt: string;
	url: string;
	reactions: { emoji: string; users: { id: string; name: string }[] }[];
};
type Body = {
	items?: Comment[];
	total?: number;
	limit?: number;
	offset?: number;
	error?: { code: string; message: string; fields?: Record<string, string[]> };
} & Partial<Comment>;

let db: DB;
let base: ReturnType<typeof createTestBase>;
let admin: Actor, member: Actor, other: Actor;
let token: string;

beforeEach(async () => {
	db = await createTestDb();
	base = createTestBase(db);
	admin = await seedUser(db, 'admin', 'admin');
	member = await seedUser(db, 'member', 'member');
	other = await seedUser(db, 'member', 'other');
	await seedProject(db, { members: [member, other] });
	// API キーを作れるのは管理者だけ
	token = (await createApiKey(ctxOf(base, admin), { name: 'CLI' })).token;
	await createIssue(ctxOf(base, member), 'ACME', { title: 'A' });
});

async function call(
	handler: typeof GET | typeof POST,
	opts: { number?: number; body?: unknown; query?: string } = {}
): Promise<{ status: number; body: Body }> {
	const number = opts.number ?? 1;
	const url = new URL(
		`http://localhost/api/v1/projects/acme/issues/${number}/comments${opts.query ?? ''}`
	);
	const res = (await handler({
		request: new Request(url, {
			method: handler === POST ? 'POST' : 'GET',
			headers: { Authorization: `Bearer ${token}` },
			body: handler === POST ? JSON.stringify(opts.body) : undefined
		}),
		url,
		params: { key: 'acme', number },
		locals: { base }
	} as unknown as RequestEvent as Parameters<typeof GET>[0])) as Response;
	return { status: res.status, body: (await res.json()) as Body };
}

describe('GET /issues/{number}/comments', () => {
	it('古い順に、投稿者・本文・日時・リンク・リアクションを返す', async () => {
		await addComment(ctxOf(base, other), 'ACME', 1, { body: '最初' });
		await addComment(ctxOf(base, member), 'ACME', 1, { body: '次' });
		const first = (await call(GET)).body.items![0];
		await toggleReaction(ctxOf(base, member), 'ACME', 1, first.id, { emoji: '👍' });

		const { status, body } = await call(GET);
		expect(status).toBe(200);
		expect(body).toMatchObject({ total: 2, limit: 100, offset: 0 });
		expect(body.items!.map((c) => [c.author.name, c.body])).toEqual([
			['other', '最初'],
			['member', '次']
		]);
		expect(body.items![0]).toEqual({
			id: first.id,
			author: { id: other.id, name: 'other' },
			body: '最初',
			createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			url: `http://localhost:5173/projects/ACME/issues/1#comment-${first.id}`,
			reactions: [{ emoji: '👍', users: [{ id: member.id, name: 'member' }] }]
		});
	});

	it('limit と offset で区切れる。不正な値は 400', async () => {
		for (const body of ['1', '2', '3']) await addComment(ctxOf(base, member), 'ACME', 1, { body });

		const { body } = await call(GET, { query: '?limit=1&offset=1' });
		expect(body.items!.map((c) => c.body)).toEqual(['2']);
		expect(body).toMatchObject({ total: 3, limit: 1, offset: 1 });
		expect((await call(GET, { query: '?limit=0' })).status).toBe(400);
	});

	it('無い課題・削除した課題は 404', async () => {
		expect((await call(GET, { number: 9 })).status).toBe(404);
		await deleteIssue(ctxOf(base, member), 'ACME', 1);
		expect((await call(GET)).status).toBe(404);
	});
});

describe('POST /issues/{number}/comments', () => {
	it('投稿すると 201 で作ったコメントを返し、一覧にも出る', async () => {
		const { status, body } = await call(POST, { body: { body: '  確認しました  ' } });
		expect(status).toBe(201);
		expect(body).toMatchObject({
			author: { id: admin.id, name: 'admin' },
			body: '確認しました',
			reactions: []
		});
		expect((await call(GET)).body.items!.map((c) => c.id)).toEqual([body.id]);
	});

	it('空の本文・不明な項目・オブジェクト以外は 400 で投稿しない', async () => {
		const empty = await call(POST, { body: { body: ' ' } });
		expect(empty.status).toBe(400);
		expect(empty.body.error?.fields).toEqual({ body: ['コメントを入力してください'] });
		const unknown = await call(POST, { body: { body: 'a', authorId: other.id } });
		expect(unknown.status).toBe(400);
		expect(unknown.body.error?.fields).toEqual({ authorId: ['不明な項目です'] });
		expect((await call(POST, { body: 'a' })).status).toBe(400);
		expect((await call(GET)).body.total).toBe(0);
	});

	it('削除した課題には投稿できない', async () => {
		await deleteIssue(ctxOf(base, member), 'ACME', 1);
		expect((await call(POST, { body: { body: 'a' } })).status).toBe(409);
	});
});
