import { describe, expect, it } from 'vitest';
import {
	consumeRateLimit,
	isLoginBlocked,
	isPasswordChangeBlocked,
	recordLoginFailure,
	recordLoginSuccess,
	recordPasswordChangeFailure,
	recordPasswordChangeSuccess
} from './ratelimit';
import { createTestDb } from './test-utils';

describe('consumeRateLimit', () => {
	it('窓の中で max 回までは許可し、それを超えたら拒否、窓が過ぎたらリセット', async () => {
		const db = await createTestDb();
		const limit = { windowMs: 1000, max: 2 };
		expect(await consumeRateLimit(db, 'k', limit, 0)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 10)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 20)).toBe(false);
		expect(await consumeRateLimit(db, 'other', limit, 20)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 1001)).toBe(true);
	});
});

describe('login failure limits', () => {
	const ip = '1.2.3.4';

	it('成功したログインは数えず、失敗だけで IP+メール単位に 5 回で止める', async () => {
		const db = await createTestDb();
		for (let i = 0; i < 20; i++) await recordLoginSuccess(db, ip, 'a@example.com');
		expect(await isLoginBlocked(db, ip, 'a@example.com')).toBe(false);

		for (let i = 0; i < 5; i++) {
			expect(await isLoginBlocked(db, ip, 'a@example.com', i)).toBe(false);
			await recordLoginFailure(db, ip, 'a@example.com', i);
		}
		expect(await isLoginBlocked(db, ip, 'a@example.com', 10)).toBe(true);
		// 同じ IP の別ユーザーは影響を受けない（社内 NAT 想定）
		expect(await isLoginBlocked(db, ip, 'b@example.com', 10)).toBe(false);
		// 15 分経てば解除
		expect(await isLoginBlocked(db, ip, 'a@example.com', 15 * 60_000)).toBe(false);
	});

	it('成功するとそのメールアドレスの失敗回数はリセットされる', async () => {
		const db = await createTestDb();
		for (let i = 0; i < 4; i++) await recordLoginFailure(db, ip, 'a@example.com', i);
		await recordLoginSuccess(db, ip, 'a@example.com');
		await recordLoginFailure(db, ip, 'a@example.com', 10);
		expect(await isLoginBlocked(db, ip, 'a@example.com', 11)).toBe(false);
	});

	it('IP 全体の失敗は 30 回で止める（総当たり対策）', async () => {
		const db = await createTestDb();
		for (let i = 0; i < 30; i++) await recordLoginFailure(db, ip, `u${i}@example.com`, i);
		expect(await isLoginBlocked(db, ip, 'new@example.com', 40)).toBe(true);
		expect(await isLoginBlocked(db, '5.6.7.8', 'new@example.com', 40)).toBe(false);
	});
});

describe('password change failure limits', () => {
	it('現在のパスワードの間違いはユーザー単位に 5 回で止め、15 分で解除する', async () => {
		const db = await createTestDb();
		for (let i = 0; i < 5; i++) {
			expect(await isPasswordChangeBlocked(db, 'u1', i)).toBe(false);
			await recordPasswordChangeFailure(db, 'u1', i);
		}
		expect(await isPasswordChangeBlocked(db, 'u1', 10)).toBe(true);
		expect(await isPasswordChangeBlocked(db, 'u2', 10)).toBe(false);
		expect(await isPasswordChangeBlocked(db, 'u1', 15 * 60_000)).toBe(false);
	});

	it('変更できたら失敗回数はリセットされる', async () => {
		const db = await createTestDb();
		for (let i = 0; i < 4; i++) await recordPasswordChangeFailure(db, 'u1', i);
		await recordPasswordChangeSuccess(db, 'u1');
		await recordPasswordChangeFailure(db, 'u1', 10);
		expect(await isPasswordChangeBlocked(db, 'u1', 11)).toBe(false);
	});
});
