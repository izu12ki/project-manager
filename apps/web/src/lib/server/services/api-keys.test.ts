import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { apiKey, user } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedUser } from '../test-utils';
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from './api-keys';

let db: DB;
let base: ReturnType<typeof createTestBase>;

beforeEach(async () => {
	db = await createTestDb();
	base = createTestBase(db);
});

describe('api keys', () => {
	it('作成したトークンで認証でき、持ち主が actor になる', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
		expect(token).toMatch(/^pm_[A-Za-z0-9_-]{43}$/);
		const rows = await db.select().from(apiKey);
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(token);
		const r = await authenticateApiKey(base, token);
		expect(r?.actor.id).toBe(admin.id);
		expect(r?.apiKeyId).toBe(rows[0].id);
		expect(await authenticateApiKey(base, 'pm_unknown')).toBeNull();
	});

	it('prefix はトークンの先頭 7 文字', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
		const [k] = await listApiKeys(ctxOf(base, admin));
		expect(k.prefix).toBe(token.slice(0, 7));
	});

	it('無効化したキーは null を返す', async () => {
		const admin = await seedUser(db, 'admin');
		const ctx = ctxOf(base, admin);
		const { token } = await createApiKey(ctx, { name: 'CLI' });
		const [k] = await listApiKeys(ctx);
		await revokeApiKey(ctx, k.id);
		expect(await authenticateApiKey(base, token)).toBeNull();
		expect(await listApiKeys(ctx)).toHaveLength(0);
	});

	it('持ち主が member に降格すると null、admin に戻ると再び認証できる', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
		await db.update(user).set({ role: 'member' }).where(eq(user.id, admin.id));
		expect(await authenticateApiKey(base, token)).toBeNull();
		await db.update(user).set({ role: 'admin' }).where(eq(user.id, admin.id));
		expect((await authenticateApiKey(base, token))?.actor.id).toBe(admin.id);
	});

	it('持ち主が無効化されると null', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));
		expect(await authenticateApiKey(base, token)).toBeNull();
	});

	it('member は createApiKey できない（forbidden）', async () => {
		const member = await seedUser(db, 'member');
		await expect(createApiKey(ctxOf(base, member), { name: 'CLI' })).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it('名前は 1〜50 文字', async () => {
		const admin = await seedUser(db, 'admin');
		const ctx = ctxOf(base, admin);
		await expect(createApiKey(ctx, { name: ' ' })).rejects.toMatchObject({ code: 'validation' });
		await expect(createApiKey(ctx, { name: 'a'.repeat(51) })).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('他人のキーは revoke できない（not_found）', async () => {
		const a = await seedUser(db, 'admin', 'a');
		const b = await seedUser(db, 'admin', 'b');
		await createApiKey(ctxOf(base, a), { name: 'CLI' });
		const [k] = await listApiKeys(ctxOf(base, a));
		await expect(revokeApiKey(ctxOf(base, b), k.id)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(revokeApiKey(ctxOf(base, a), 'unknown')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('lastUsedAt は前回から 60 秒以上空いたときだけ更新する', async () => {
		const admin = await seedUser(db, 'admin');
		const { token } = await createApiKey(ctxOf(base, admin), { name: 'CLI' });
		await authenticateApiKey(base, token);
		await Promise.all(base.pending.splice(0));
		const [first] = await db.select().from(apiKey);
		expect(first.lastUsedAt).not.toBeNull();

		await authenticateApiKey(base, token);
		expect(base.pending).toHaveLength(0);

		const old = new Date(Date.now() - 61_000);
		await db.update(apiKey).set({ lastUsedAt: old });
		await authenticateApiKey(base, token);
		await Promise.all(base.pending.splice(0));
		const [again] = await db.select().from(apiKey);
		expect(again.lastUsedAt!.getTime()).toBeGreaterThan(old.getTime() + 60_000);
	});
});
