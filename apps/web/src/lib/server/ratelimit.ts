import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { DB } from './db';
import { rateLimit } from './db/schema';

export interface Limit {
	windowMs: number;
	max: number;
}

export const LOGIN_LIMIT: Limit = { windowMs: 60_000, max: 5 };
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
