import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '#lib/server/db/index.ts';
import { createApiKey } from '#lib/server/services/api-keys.ts';
import { listIssues } from '#lib/server/services/issues.ts';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	seedProject,
	seedUser
} from '#lib/server/test-utils.ts';
import { PATCH, POST } from './+server';

type Body = { error?: { code: string; fields?: Record<string, string[]> }; numbers?: number[] };

let db: DB;
let base: ReturnType<typeof createTestBase>;
let token: string;
let ctx: ReturnType<typeof ctxOf>;

beforeEach(async () => {
	db = await createTestDb();
	base = createTestBase(db);
	const admin = await seedUser(db, 'admin');
	await seedProject(db);
	ctx = ctxOf(base, admin);
	token = (await createApiKey(ctx, { name: 'CLI' })).token;
});

function call(handler: typeof POST, body: unknown, query = ''): Promise<Response> {
	const url = new URL(`http://localhost/api/v1/projects/acme/issues/bulk${query}`);
	return handler({
		request: new Request(url, {
			method: handler === POST ? 'POST' : 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body)
		}),
		url,
		params: { key: 'acme' },
		locals: { base }
	} as unknown as RequestEvent as Parameters<typeof POST>[0]) as Promise<Response>;
}

const count = async () => (await listIssues(ctx, 'ACME', {})).length;

describe('POST /issues/bulk', () => {
	it('dryRun=1 などの不正値は 400 で何も書かない', async () => {
		for (const v of ['1', 'TRUE', '', 'yes']) {
			const res = await call(POST, { items: [{ title: 'a' }] }, `?dryRun=${v}`);
			expect(res.status).toBe(400);
			expect(((await res.json()) as Body).error?.fields).toEqual({
				dryRun: ['dryRun には true か false を指定してください']
			});
		}
		expect(await count()).toBe(0);
	});

	it('dryRun=true は 200 で numbers が空、何も書かない', async () => {
		const res = await call(POST, { items: [{ title: 'a' }] }, '?dryRun=true');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ numbers: [] });
		expect(await count()).toBe(0);
	});

	it('dryRun=false と未指定は書き込んで 201', async () => {
		const res = await call(POST, { items: [{ title: 'a' }] }, '?dryRun=false');
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ numbers: [1] });
		expect((await call(POST, { items: [{ title: 'b' }] })).status).toBe(201);
		expect(await count()).toBe(2);
	});

	it('不明なキーは items.<i>.<key> で 400（dryRun でも検出）', async () => {
		const body = { items: [{ title: 'a' }, { title: 'b', foo: 1, resolution: 'fixed' }] };
		for (const q of ['', '?dryRun=true']) {
			const res = await call(POST, body, q);
			expect(res.status).toBe(400);
			expect(((await res.json()) as Body).error?.fields).toEqual({
				'items.1.foo': ['不明な項目です'],
				'items.1.resolution': ['不明な項目です']
			});
		}
		expect(await count()).toBe(0);
	});

	it('トップレベルの不明キーも 400', async () => {
		const res = await call(POST, { items: [{ title: 'a' }], extra: 1 });
		expect(res.status).toBe(400);
		expect(((await res.json()) as Body).error?.fields).toEqual({ extra: ['不明な項目です'] });
	});
});

describe('PATCH /issues/bulk', () => {
	it('null の項目は空にする（要素ごとに変換される）', async () => {
		await call(POST, { items: [{ title: 'a', dueDate: '2026-12-31' }] });
		const res = await call(PATCH, { items: [{ number: 1, dueDate: null }] });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ numbers: [1] });
		const [row] = await listIssues(ctx, 'ACME', {});
		expect(row.dueDate).toBeNull();
	});

	it('dryRun=1 は 400、dryRun=true は書かない', async () => {
		await call(POST, { items: [{ title: 'a' }] });
		const items = [{ number: 1, title: 'changed' }];
		expect((await call(PATCH, { items }, '?dryRun=1')).status).toBe(400);
		const res = await call(PATCH, { items }, '?dryRun=true');
		expect(await res.json()).toEqual({ numbers: [] });
		expect((await listIssues(ctx, 'ACME', {}))[0].title).toBe('a');
	});

	it('resolution と number は更新で使え、不明キーは 400', async () => {
		await call(POST, { items: [{ title: 'a' }] });
		const ok = await call(PATCH, { items: [{ number: 1, status: 'done', resolution: 'fixed' }] });
		expect(ok.status).toBe(200);
		const res = await call(PATCH, { items: [{ number: 1, bogus: 1 }] });
		expect(res.status).toBe(400);
		expect(((await res.json()) as Body).error?.fields).toEqual({
			'items.0.bogus': ['不明な項目です']
		});
	});
});
