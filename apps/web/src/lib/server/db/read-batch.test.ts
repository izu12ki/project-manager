import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb, roundTrips, seedUser } from '../test-utils';
import { user } from './schema';
import { createReadBatcher } from './read-batch';

describe('createReadBatcher', () => {
	it('sends concurrent calls as one batch and splits the results', async () => {
		const db = await createTestDb();
		const alice = await seedUser(db, 'member', 'Alice');
		const read = createReadBatcher(db);
		const before = roundTrips(db);
		const [[names, one], [count]] = await Promise.all([
			read([
				db.select({ name: user.name }).from(user),
				db.select({ n: sql<number>`1` }).from(user)
			]),
			read([db.select({ n: sql<number>`count(*)` }).from(user)])
		]);
		expect(roundTrips(db) - before).toBe(1);
		expect(names).toEqual([{ name: alice.name }]);
		expect(one).toEqual([{ n: 1 }]);
		expect(count).toEqual([{ n: 1 }]);
	});

	it('starts a new batch for calls made after an await', async () => {
		const db = await createTestDb();
		await seedUser(db, 'member', 'Alice');
		const read = createReadBatcher(db);
		const before = roundTrips(db);
		await read([db.select().from(user)]);
		await read([db.select().from(user)]);
		expect(roundTrips(db) - before).toBe(2);
	});

	it('rejects every call in the batch when a statement fails', async () => {
		const db = await createTestDb();
		const read = createReadBatcher(db);
		const results = await Promise.allSettled([
			read([db.select().from(user)]),
			read([db.select({ x: sql`no_such_function()` }).from(user)])
		]);
		expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
	});
});
