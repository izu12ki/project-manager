// 管理者以外のキーで、実際の /api/v1 のハンドラを呼ぶ。キーは持ち主の画面の権限の範囲でだけ動く
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '#lib/server/authz.ts';
import { createApiKey } from '#lib/server/services/api-keys.ts';
import { createIssue, getIssue } from '#lib/server/services/issues.ts';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	seedProject,
	seedUser
} from '#lib/server/test-utils.ts';
import * as Projects from './projects/+server';
import * as Project from './projects/[key]/+server';
import * as Issues from './projects/[key]/issues/+server';
import * as Issue from './projects/[key]/issues/[number=int]/+server';
import * as Comments from './projects/[key]/issues/[number=int]/comments/+server';
import * as Bulk from './projects/[key]/issues/bulk/+server';

type Handler = (event: RequestEvent) => Promise<Response> | Response;

let base: ReturnType<typeof createTestBase>;
let admin: Actor, guest: Actor;
let token: string;

beforeEach(async () => {
	const db = await createTestDb();
	base = createTestBase(db);
	admin = await seedUser(db, 'admin');
	guest = await seedUser(db, 'guest');
	await seedProject(db, { key: 'ACME', members: [guest] });
	await seedProject(db, { key: 'HIDDEN' });
	await createIssue(ctxOf(base, admin), 'ACME', { title: 'shared' });
	await createIssue(ctxOf(base, admin), 'HIDDEN', { title: 'secret' });
	token = (await createApiKey(ctxOf(base, guest), { name: 'CLI' })).token;
});

async function call(
	handler: Handler,
	method: string,
	path: string,
	params: Record<string, string>,
	body?: unknown
) {
	const url = new URL(`http://localhost/api/v1${path}`);
	const res = await handler({
		request: new Request(url, {
			method,
			headers: { Authorization: `Bearer ${token}` },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		url,
		params,
		locals: { base }
	} as unknown as RequestEvent);
	return { status: res.status, text: await res.text() };
}

describe('ゲストのキー', () => {
	it('一覧に出るのは参加しているプロジェクトだけ', async () => {
		const res = await call(Projects.GET as Handler, 'GET', '/projects', {});
		expect(res.status).toBe(200);
		expect(JSON.parse(res.text).projects.map((p: { key: string }) => p.key)).toEqual(['ACME']);
	});

	it('参加していないプロジェクトは、読み書きとも 404', async () => {
		const key = 'hidden';
		const one = { key, number: '1' };
		const results = [
			await call(Project.GET as Handler, 'GET', `/projects/${key}`, { key }),
			await call(Issues.GET as Handler, 'GET', `/projects/${key}/issues`, { key }),
			await call(
				Issues.POST as Handler,
				'POST',
				`/projects/${key}/issues`,
				{ key },
				{ title: 'x' }
			),
			await call(Issue.GET as Handler, 'GET', `/projects/${key}/issues/1`, one),
			await call(Issue.PATCH as Handler, 'PATCH', `/projects/${key}/issues/1`, one, { title: 'x' }),
			await call(Comments.GET as Handler, 'GET', `/projects/${key}/issues/1/comments`, one),
			await call(Comments.POST as Handler, 'POST', `/projects/${key}/issues/1/comments`, one, {
				body: 'x'
			}),
			await call(
				Bulk.POST as Handler,
				'POST',
				`/projects/${key}/issues/bulk`,
				{ key },
				{
					items: [{ title: 'x' }]
				}
			),
			await call(
				Bulk.PATCH as Handler,
				'PATCH',
				`/projects/${key}/issues/bulk`,
				{ key },
				{
					items: [{ number: 1, title: 'x' }]
				}
			)
		];
		expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(404));
		expect((await getIssue(ctxOf(base, admin), 'HIDDEN', 1)).issue.title).toBe('secret');
	});

	it('参加しているプロジェクトでは画面と同じく一括更新でき、応答にメールアドレスは出ない', async () => {
		const key = 'acme';
		const bulk = await call(
			Bulk.PATCH as Handler,
			'PATCH',
			`/projects/${key}/issues/bulk`,
			{ key },
			{
				items: [{ number: 1, status: 'in_progress', assigneeIds: [guest.id] }]
			}
		);
		expect(bulk.status).toBe(200);
		const detail = await call(Project.GET as Handler, 'GET', `/projects/${key}`, { key });
		const list = await call(Issues.GET as Handler, 'GET', `/projects/${key}/issues`, { key });
		for (const res of [detail, list]) {
			expect(res.status).toBe(200);
			expect(res.text).not.toContain('@example.com');
		}
		expect(JSON.parse(list.text).items[0]).toMatchObject({ number: 1, status: 'in_progress' });
	});
});
