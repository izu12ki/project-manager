import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiError, apiHandler, readJson } from './api';
import type { DB } from './db';
import { user } from './db/schema';
import { AppError } from './errors';
import { createApiKey } from './services/api-keys';
import { createTestBase, createTestDb, ctxOf, seedUser } from './test-utils';

type ErrBody = { error: { code: string; message: string } };

let db: DB;
let base: ReturnType<typeof createTestBase>;

beforeEach(async () => {
	db = await createTestDb();
	base = createTestBase(db);
});

function eventOf(headers: Record<string, string> = {}, body?: string) {
	return {
		request: new Request('http://localhost/api/v1/me', {
			method: body === undefined ? 'GET' : 'POST',
			headers,
			body
		}),
		locals: { base }
	} as unknown as RequestEvent;
}

async function adminToken() {
	const admin = await seedUser(db, 'admin');
	const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
	return token;
}

describe('apiHandler', () => {
	it('Authorization なしは 401', async () => {
		const res = await apiHandler(eventOf(), async () => ({ ok: true }));
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			error: { code: 'unauthorized', message: 'APIキーが無効です' }
		});
	});

	it('Bearer の形式違いは 401', async () => {
		const token = await adminToken();
		for (const h of [`Basic ${token}`, token, 'Bearer ', `Bearer pm_unknown`]) {
			const res = await apiHandler(eventOf({ Authorization: h }), async () => ({}));
			expect(res.status).toBe(401);
		}
	});

	it('Bearer スキーム名は大文字小文字を区別しない', async () => {
		const token = await adminToken();
		for (const scheme of ['bearer', 'BEARER']) {
			const res = await apiHandler(eventOf({ Authorization: `${scheme} ${token}` }), async () => ({
				ok: true
			}));
			expect(res.status).toBe(200);
		}
	});

	it('閲覧者に変わった人のキーは 401', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'x' });
		await db.update(user).set({ role: 'viewer' }).where(eq(user.id, admin.id));
		const res = await apiHandler(eventOf({ Authorization: `Bearer ${token}` }), async () => ({}));
		expect(res.status).toBe(401);
	});

	it('有効なキーなら fn の結果を返す', async () => {
		const token = await adminToken();
		const res = await apiHandler(
			eventOf({ Authorization: `Bearer ${token}` }),
			async () => ({ ok: true }),
			{ status: 201 }
		);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('121 回目は 429', async () => {
		const token = await adminToken();
		const headers = { Authorization: `Bearer ${token}` };
		for (let i = 0; i < 120; i++) {
			const res = await apiHandler(eventOf(headers), async () => ({}));
			expect(res.status).toBe(200);
		}
		const res = await apiHandler(eventOf(headers), async () => ({}));
		expect(res.status).toBe(429);
		expect(((await res.json()) as ErrBody).error.code).toBe('rate_limited');
	});

	it('レート制限は人ごと。同じ人の別のキーでも 121 回目は 429、ほかの人は通る', async () => {
		const admin = await seedUser(db, 'admin');
		const other = await seedUser(db, 'member', 'other');
		const a = (await createApiKey(ctxOf(base, admin), { name: 'a' })).token;
		const b = (await createApiKey(ctxOf(base, admin), { name: 'b' })).token;
		const c = (await createApiKey(ctxOf(base, other), { name: 'c' })).token;
		for (let i = 0; i < 120; i++) {
			const token = i % 2 === 0 ? a : b;
			const res = await apiHandler(eventOf({ Authorization: `Bearer ${token}` }), async () => ({}));
			expect(res.status).toBe(200);
		}
		const res = await apiHandler(eventOf({ Authorization: `Bearer ${b}` }), async () => ({}));
		expect(res.status).toBe(429);
		const others = await apiHandler(eventOf({ Authorization: `Bearer ${c}` }), async () => ({}));
		expect(others.status).toBe(200);
	});

	it('AppError(not_found) は 404 で { error: { code, message } }', async () => {
		const token = await adminToken();
		const res = await apiHandler(eventOf({ Authorization: `Bearer ${token}` }), async () => {
			throw new AppError('not_found', 'プロジェクトが見つかりません');
		});
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { code: 'not_found', message: 'プロジェクトが見つかりません' }
		});
	});

	it('validation の fields がそのまま返る', async () => {
		const token = await adminToken();
		const res = await apiHandler(eventOf({ Authorization: `Bearer ${token}` }), async () => {
			throw new AppError('validation', '入力が不正です', { 'items.0.title': ['必須です'] });
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: {
				code: 'validation',
				message: '入力が不正です',
				fields: { 'items.0.title': ['必須です'] }
			}
		});
	});

	it('不正な JSON は 400', async () => {
		const token = await adminToken();
		const res = await apiHandler(
			eventOf({ Authorization: `Bearer ${token}` }, '{oops'),
			async (ctx) => {
				void ctx;
				return readJson(new Request('http://x', { method: 'POST', body: '{oops' }));
			}
		);
		expect(res.status).toBe(400);
		expect(((await res.json()) as ErrBody).error.message).toBe('JSON の形式が正しくありません');
	});

	it('未知の例外は内部情報を出さず 500', async () => {
		const res = apiError(new Error('secret db path'));
		expect(res.status).toBe(500);
		const body = (await res.json()) as ErrBody;
		expect(body.error.code).toBe('internal');
		expect(JSON.stringify(body)).not.toContain('secret');
	});
});
