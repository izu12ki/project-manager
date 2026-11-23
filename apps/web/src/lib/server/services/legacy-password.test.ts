import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { account } from '../db/schema';
import { hashPasswordKey } from '../password';
import { createTestDb } from '../test-utils';
import { credentialUserInserts } from './credentials';
import { upgradeLegacyPassword } from './legacy-password';

const KEY = 'a'.repeat(64);
let legacyHash: string;

/** かかった時間（ms） */
async function elapsed(fn: () => Promise<unknown>): Promise<number> {
	const start = performance.now();
	await fn();
	return performance.now() - start;
}

beforeAll(async () => {
	// better-auth の既定（scrypt）で作った旧形式のハッシュ
	legacyHash = await hashPassword('old-password-1');
});

async function seed(passwordHash: string) {
	const db = await createTestDb();
	const { id, statements } = credentialUserInserts(db, {
		name: 'A',
		email: 'a@example.com',
		role: 'member',
		passwordHash
	});
	await db.batch(statements);
	return { db, userId: id };
}

const storedHash = async (db: DB, userId: string) =>
	(await db.select().from(account).where(eq(account.userId, userId)))[0].password;

describe('upgradeLegacyPassword', () => {
	it('旧形式の人が正しい生のパスワードを送ると、鍵の形式で保存し直す（メールアドレスで探す）', async () => {
		const { db, userId } = await seed(legacyHash);
		expect(await upgradeLegacyPassword(db, { email: 'a@example.com' }, 'old-password-1', KEY)).toBe(
			true
		);
		expect(await storedHash(db, userId)).toBe(await hashPasswordKey(KEY));
	});

	it('ユーザー ID でも探せる', async () => {
		const { db, userId } = await seed(legacyHash);
		expect(await upgradeLegacyPassword(db, { userId }, 'old-password-1', KEY)).toBe(true);
		expect(await storedHash(db, userId)).toBe(await hashPasswordKey(KEY));
	});

	it('生のパスワードが違えば旧形式のまま', async () => {
		const { db, userId } = await seed(legacyHash);
		expect(await upgradeLegacyPassword(db, { userId }, 'wrong-password', KEY)).toBe(false);
		expect(await storedHash(db, userId)).toBe(legacyHash);
	});

	it('129 文字以上の生のパスワードは照合しない', async () => {
		const { db, userId } = await seed(legacyHash);
		expect(await upgradeLegacyPassword(db, { userId }, 'x'.repeat(129), KEY)).toBe(false);
		expect(await storedHash(db, userId)).toBe(legacyHash);
	});

	it('すでに鍵の形式なら何もしない', async () => {
		const newHash = await hashPasswordKey('b'.repeat(64));
		const { db, userId } = await seed(newHash);
		expect(await upgradeLegacyPassword(db, { userId }, 'old-password-1', KEY)).toBe(false);
		expect(await storedHash(db, userId)).toBe(newHash);
	});

	it('いないメールアドレスなら false', async () => {
		const { db } = await seed(legacyHash);
		expect(
			await upgradeLegacyPassword(db, { email: 'nobody@example.com' }, 'old-password-1', KEY)
		).toBe(false);
	});

	// scrypt（数十 ms）とメモリ上の DB の問い合わせ（1ms 前後）の差は大きいので、比で比べる
	it('旧形式の人が残っている間は、いない人・移行済みの人も旧形式の人と同じくらい時間がかかる（登録の有無を漏らさない）', async () => {
		const { db, userId } = await seed(legacyHash);
		await db.batch(
			credentialUserInserts(db, {
				name: 'B',
				email: 'b@example.com',
				role: 'member',
				passwordHash: await hashPasswordKey(KEY)
			}).statements
		);
		const legacy = await elapsed(() =>
			upgradeLegacyPassword(db, { userId }, 'wrong-password', KEY)
		);
		const nobody = await elapsed(() =>
			upgradeLegacyPassword(db, { email: 'nobody@example.com' }, 'wrong-password', KEY)
		);
		const upgraded = await elapsed(() =>
			upgradeLegacyPassword(db, { email: 'b@example.com' }, 'wrong-password', KEY)
		);
		expect(nobody).toBeGreaterThan(legacy / 2);
		expect(upgraded).toBeGreaterThan(legacy / 2);
	});

	it('旧形式の人がいなければ scrypt をかけない（無料プランの CPU 時間）', async () => {
		const { db, userId } = await seed(legacyHash);
		const legacy = await elapsed(() =>
			upgradeLegacyPassword(db, { userId }, 'wrong-password', KEY)
		);
		const fresh = (await seed(await hashPasswordKey(KEY))).db;
		const nobody = await elapsed(() =>
			upgradeLegacyPassword(fresh, { email: 'nobody@example.com' }, 'wrong-password', KEY)
		);
		expect(nobody).toBeLessThan(legacy / 2);
	});
});
