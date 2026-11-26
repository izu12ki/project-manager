import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createTestDb, roundTrips, seedProject, seedUser } from '../test-utils';
import type { DB } from '.';
import { cachedRead } from './cached-read';
import { project, user } from './schema';
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

	it('accepts only reads in its type', async () => {
		const db = await createTestDb();
		const read = createReadBatcher(db);
		// 型だけを確かめる（呼ばない）
		const typeOnly = () => {
			// @ts-expect-error insert は渡せない
			void read([db.insert(user).values({ id: 'x', name: 'x', email: 'x@example.com' })]);
			// @ts-expect-error update は渡せない（returning 付きでも）
			void read([db.update(user).set({ name: 'x' }).returning()]);
			// @ts-expect-error delete は渡せない
			void read([db.select().from(user), db.delete(user)]);
			void read([db.select().from(user), db.query.user.findFirst()]);
		};
		expect(typeOnly).toBeTypeOf('function');
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

	describe('cachedRead の同じ文（同じ組み立て・同じ値）', () => {
		const byKey = cachedRead(['key'], (db, p) =>
			db.select({ name: project.name }).from(project).where(eq(project.key, p.key))
		);
		const rename = (db: DB, name: string) =>
			db.update(project).set({ name }).where(eq(project.key, 'ACME'));

		/** db.batch に渡した文の数を数える */
		function countStatements(db: DB) {
			const sent: number[] = [];
			const batch = db.batch.bind(db);
			vi.spyOn(db, 'batch').mockImplementation((items) => {
				sent.push(items.length);
				return batch(items);
			});
			return sent;
		}

		it('同じ batch の中では 1 回だけ送り、結果を共有する', async () => {
			const db = await createTestDb();
			await seedProject(db, { key: 'ACME', name: 'Acme' });
			await seedProject(db, { key: 'OTHER', name: 'Other' });
			const read = createReadBatcher(db);
			const sent = countStatements(db);
			const [[a1, o1], [a2]] = await Promise.all([
				read([byKey(db, { key: 'ACME' }), byKey(db, { key: 'OTHER' })]),
				read([byKey(db, { key: 'ACME' })])
			]);
			expect(sent).toEqual([2]);
			expect(a1).toEqual([{ name: 'Acme' }]);
			expect(o1).toEqual([{ name: 'Other' }]);
			expect(a2).toBe(a1);
		});

		it('既定では、次の batch では送り直す（間の書き込みが見える）', async () => {
			const db = await createTestDb();
			await seedProject(db, { key: 'ACME', name: 'Acme' });
			const read = createReadBatcher(db);
			const sent = countStatements(db);
			const [before] = await read([byKey(db, { key: 'ACME' })]);
			await rename(db, 'Renamed');
			const [after] = await read([byKey(db, { key: 'ACME' })]);
			expect(sent).toEqual([1, 1]);
			expect(before).toEqual([{ name: 'Acme' }]);
			expect(after).toEqual([{ name: 'Renamed' }]);
		});

		it('shareAcrossBatches なら、次の batch でも前の結果を使う', async () => {
			const db = await createTestDb();
			await seedProject(db, { key: 'ACME', name: 'Acme' });
			await seedProject(db, { key: 'OTHER', name: 'Other' });
			const read = createReadBatcher(db, { shareAcrossBatches: true });
			const sent = countStatements(db);
			const [first] = await read([byKey(db, { key: 'ACME' })]);
			const [again, other] = await read([byKey(db, { key: 'ACME' }), byKey(db, { key: 'OTHER' })]);
			expect(sent).toEqual([1, 1]);
			expect(again).toBe(first);
			expect(other).toEqual([{ name: 'Other' }]);
		});

		it('失敗した文の結果は使い回さない', async () => {
			const db = await createTestDb();
			await seedProject(db, { key: 'ACME', name: 'Acme' });
			const read = createReadBatcher(db, { shareAcrossBatches: true });
			const batch = db.batch.bind(db);
			vi.spyOn(db, 'batch')
				.mockImplementationOnce(() => Promise.reject(new Error('D1 is down')))
				.mockImplementation((items) => batch(items));
			await expect(read([byKey(db, { key: 'ACME' })])).rejects.toThrow('D1 is down');
			expect(await read([byKey(db, { key: 'ACME' })])).toEqual([[{ name: 'Acme' }]]);
		});

		it('cachedRead でない文は、同じ形でもそれぞれ送る', async () => {
			const db = await createTestDb();
			const read = createReadBatcher(db, { shareAcrossBatches: true });
			const sent = countStatements(db);
			await Promise.all([
				read([db.select({ n: sql<number>`1` }).from(user)]),
				read([db.select({ n: sql<number>`1` }).from(user)])
			]);
			expect(sent).toEqual([2]);
		});
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
