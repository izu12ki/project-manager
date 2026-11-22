import { describe, expect, it } from 'vitest';
import { account, user } from '../db/schema';
import { createTestBase, createTestDb } from '../test-utils';
import { createFirstAdmin, needsSetup } from './setup';

const input = { name: '管理者', email: 'Admin@Example.com', password: 'password-1234' };

describe('setup', () => {
	it('ユーザーが 0 人なら admin を作り、credential アカウントにハッシュを保存する', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		expect(await needsSetup(db)).toBe(true);

		expect(await createFirstAdmin(base, input)).toEqual({ email: 'admin@example.com' });

		const [u] = await db.select().from(user);
		expect(u.role).toBe('admin');
		expect(u.emailVerified).toBe(true);
		const [a] = await db.select().from(account);
		expect(a).toMatchObject({
			providerId: 'credential',
			accountId: u.id,
			password: 'test-hash:password-1234'
		});
		expect(await needsSetup(db)).toBe(false);
	});

	it('2 回目は conflict', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		await createFirstAdmin(base, input);
		await expect(
			createFirstAdmin(base, { ...input, email: 'b@example.com' })
		).rejects.toMatchObject({
			code: 'conflict'
		});
	});

	it('同時に 2 回実行しても管理者は 1 人だけ', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const results = await Promise.allSettled([
			createFirstAdmin(base, { ...input, name: 'A', email: 'a@example.com' }),
			createFirstAdmin(base, { ...input, name: 'B', email: 'b@example.com' })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected');
		expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'conflict' });
		expect(await db.$count(user)).toBe(1);
		expect(await db.$count(account)).toBe(1);
	});

	it('短いパスワードは validation', async () => {
		const db = await createTestDb();
		await expect(
			createFirstAdmin(createTestBase(db), { ...input, password: 'short' })
		).rejects.toMatchObject({
			code: 'validation'
		});
	});
});
