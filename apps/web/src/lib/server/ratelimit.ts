import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { DB } from './db';
import { rateLimit } from './db/schema';

export interface Limit {
	windowMs: number;
	max: number;
}

/** ログイン失敗の上限。成功は数えない。IP+メール単位と、総当たり対策の IP 全体単位の 2 段。 */
export const LOGIN_FAILURE_LIMIT: Limit = { windowMs: 15 * 60_000, max: 5 };
export const LOGIN_IP_FAILURE_LIMIT: Limit = { windowMs: 15 * 60_000, max: 30 };
export const RESET_LIMIT: Limit = { windowMs: 15 * 60_000, max: 3 };
export const SIGNUP_LIMIT: Limit = { windowMs: 15 * 60_000, max: 10 };

/** 固定窓のレート制限。キーは better-auth と衝突しないよう呼び出し側で `app:` を付ける。lastRequest は窓の開始時刻。 */
export async function consumeRateLimit(
	db: DB,
	key: string,
	limit: Limit,
	now: number = Date.now()
): Promise<boolean> {
	const [row] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
	if (!row || now - row.lastRequest >= limit.windowMs) {
		await db
			.insert(rateLimit)
			.values({ id: uuidv7(), key, count: 1, lastRequest: now })
			.onConflictDoUpdate({ target: rateLimit.key, set: { count: 1, lastRequest: now } });
		return true;
	}
	if (row.count >= limit.max) return false;
	await db
		.update(rateLimit)
		.set({ count: row.count + 1 })
		.where(eq(rateLimit.key, key));
	return true;
}

async function isExhausted(db: DB, key: string, limit: Limit, now: number): Promise<boolean> {
	const [row] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
	return !!row && now - row.lastRequest < limit.windowMs && row.count >= limit.max;
}

const loginKey = (ip: string, email: string) => `app:login-fail:${ip}:${email}`;
const loginIpKey = (ip: string) => `app:login-fail-ip:${ip}`;

export async function isLoginBlocked(
	db: DB,
	ip: string,
	email: string,
	now: number = Date.now()
): Promise<boolean> {
	return (
		(await isExhausted(db, loginKey(ip, email), LOGIN_FAILURE_LIMIT, now)) ||
		(await isExhausted(db, loginIpKey(ip), LOGIN_IP_FAILURE_LIMIT, now))
	);
}

export async function recordLoginFailure(
	db: DB,
	ip: string,
	email: string,
	now: number = Date.now()
): Promise<void> {
	await consumeRateLimit(db, loginKey(ip, email), LOGIN_FAILURE_LIMIT, now);
	await consumeRateLimit(db, loginIpKey(ip), LOGIN_IP_FAILURE_LIMIT, now);
}

/** 成功したら、そのメールアドレスの失敗回数を消す（IP 全体の回数は残す）。 */
export async function recordLoginSuccess(db: DB, ip: string, email: string): Promise<void> {
	await db.delete(rateLimit).where(eq(rateLimit.key, loginKey(ip, email)));
}
