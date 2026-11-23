import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { user } from './db/schema';
import { createTestDb, roundTrips } from './test-utils';

describe('roundTrips', () => {
	it('counts single queries and batches as one each', async () => {
		const db = await createTestDb();
		const before = roundTrips(db);
		await db.select().from(user);
		expect(roundTrips(db) - before).toBe(1);
		await db.batch([db.select().from(user), db.select({ n: sql<number>`1` }).from(user)]);
		expect(roundTrips(db) - before).toBe(2);
	});
});
