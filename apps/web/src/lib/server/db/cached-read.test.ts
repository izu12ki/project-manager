import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb, seedProject } from '../test-utils';
import { cachedRead } from './cached-read';
import { project } from './schema';

describe('cachedRead', () => {
	it('builds the statement once and fills each call with its own values', async () => {
		let builds = 0;
		const byKey = cachedRead(['key', 'limit'], (db, p) => {
			builds++;
			return db
				.select({ key: project.key, archivedAt: project.archivedAt })
				.from(project)
				.where(eq(project.key, p.key))
				.orderBy(asc(project.key))
				.limit(p.limit);
		});
		const db = await createTestDb();
		await seedProject(db, { key: 'ACME' });
		await seedProject(db, { key: 'OTHER', archived: true });

		const [acme, other, none] = await db.batch([
			byKey(db, { key: 'ACME', limit: 10 }),
			byKey(db, { key: 'OTHER', limit: 10 }),
			byKey(db, { key: 'OTHER', limit: 0 })
		]);
		expect(acme).toEqual([{ key: 'ACME', archivedAt: null }]);
		// 列の変換（タイムスタンプ → Date）も効く
		expect(other).toEqual([{ key: 'OTHER', archivedAt: expect.any(Date) }]);
		expect(none).toEqual([]);

		// 別の DB（別のリクエスト）でも、組み立て直さずに使える
		const db2 = await createTestDb();
		await seedProject(db2, { key: 'NEW' });
		const [fresh] = await db2.batch([byKey(db2, { key: 'NEW', limit: 1 })]);
		expect(fresh).toEqual([{ key: 'NEW', archivedAt: null }]);
		expect(builds).toBe(1);
	});
});
