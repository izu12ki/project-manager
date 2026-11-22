import { alias } from 'drizzle-orm/sqlite-core';
import { eq, inArray, sql } from 'drizzle-orm'; // eslint-disable-line no-restricted-imports -- 101 個の変数を作るために直接使う
import { describe, expect, it } from 'vitest';
import { createTestDb, seedUser } from '../test-utils';
import { insertChunks, inList } from './limits';
import { projectMember, user } from './schema';

/** 失敗したときのエラー文（drizzle が包んだものは cause の文） */
const messageOf = (p: PromiseLike<unknown>) =>
	Promise.resolve(p).then(
		() => 'resolved',
		(e: Error & { cause?: Error }) => e.cause?.message ?? e.message
	);

describe('db/limits', () => {
	it('inList: 150 個の ID でも全件に一致する', async () => {
		const db = await createTestDb();
		const ids: string[] = [];
		for (let i = 0; i < 150; i++) ids.push((await seedUser(db, 'member', `u${i}`)).id);
		const rows = await db.select({ id: user.id }).from(user).where(inList(user.id, ids));
		expect(rows).toHaveLength(150);
	});

	it('inList: 空配列は 0 件', async () => {
		const db = await createTestDb();
		await seedUser(db, 'member');
		expect(await db.select().from(user).where(inList(user.id, []))).toHaveLength(0);
	});

	it('inList: サブクエリも渡せる', async () => {
		const db = await createTestDb();
		const a = await seedUser(db, 'admin');
		await seedUser(db, 'member');
		const admins = db.select({ id: user.id }).from(user).where(eq(user.role, 'admin'));
		const rows = await db.select({ id: user.id }).from(user).where(inList(user.id, admins));
		expect(rows).toEqual([{ id: a.id }]);
	});

	it('inList: 数値の配列にも一致する', async () => {
		const db = await createTestDb();
		const rows = await db
			.select({ n: sql<number>`n` })
			.from(sql`(select 1 as n union all select 2 union all select 3)`)
			.where(inList(sql`n`, [1, 3]));
		expect(rows.map((r) => r.n)).toEqual([1, 3]);
	});

	it('insertChunks: 3 列のテーブル（project_member）120 行は 33 行ずつ', () => {
		const rows = Array.from({ length: 120 }, (_, i) => ({ projectId: 'p', userId: `u${i}` }));
		expect(insertChunks(projectMember, rows).map((c) => c.length)).toEqual([33, 33, 33, 21]);
	});

	it('emulateD1: transaction は失敗する', async () => {
		const db = await createTestDb();
		await expect(db.transaction(async () => {})).rejects.toThrow(/D1/);
	});

	it('emulateD1: 101 個の変数は失敗する', async () => {
		const db = await createTestDb();
		const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
		expect(await messageOf(db.select().from(user).where(inArray(user.id, ids)))).toMatch(/100/);
	});

	it('emulateD1: batch の中の 101 個の変数も失敗する', async () => {
		const db = await createTestDb();
		const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
		expect(
			await messageOf(
				db.batch([db.select().from(user), db.select().from(user).where(inArray(user.id, ids))])
			)
		).toMatch(/100/);
	});

	it('emulateD1: batch の select で列名が重複すると失敗する（D1 は列名をキーにした行を返すので重なる）', async () => {
		const db = await createTestDb();
		const other = alias(user, 'other');
		const joined = db
			.select({ a: user.name, b: other.name })
			.from(user)
			.innerJoin(other, eq(other.id, user.id));
		expect(await messageOf(db.batch([joined]))).toMatch(/duplicate column/);
		// batch でなければ D1 も列の並びで返すので問題ない
		await expect(joined).resolves.toEqual([]);
	});

	it('emulateD1: LIKE のパターンが 50 バイトを超えると失敗する', async () => {
		const db = await createTestDb();
		const pattern = `%${'あ'.repeat(17)}%`; // 53 バイト
		expect(
			await messageOf(
				db
					.select()
					.from(user)
					.where(sql`${user.name} like ${pattern}`)
			)
		).toMatch(/LIKE/);
	});
});
