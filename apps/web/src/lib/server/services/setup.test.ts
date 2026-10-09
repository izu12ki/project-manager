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

	it('短いパスワードは validation', async () => {
		const db = await createTestDb();
		await expect(
			createFirstAdmin(createTestBase(db), { ...input, password: 'short' })
		).rejects.toMatchObject({
			code: 'validation'
		});
	});
});
