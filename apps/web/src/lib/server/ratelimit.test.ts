import { describe, expect, it } from 'vitest';
import { consumeRateLimit } from './ratelimit';
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
