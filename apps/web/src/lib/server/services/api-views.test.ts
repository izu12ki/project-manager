import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { category, milestone } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { getProjectDetail, listProjectSummaries } from './api-views';

let db: DB;
let base: ReturnType<typeof createTestBase>;

beforeEach(async () => {
	db = await createTestDb();
	base = createTestBase(db);
});

describe('api views', () => {
	it('プロジェクト詳細にステータス・種別・カテゴリ・マイルストーン・メンバーが入り、メールアドレスは応答のどこにも含まれない', async () => {
		const admin = await seedUser(db, 'admin', 'Alice');
		const member = await seedUser(db, 'member', 'Bob');
		const { id } = await seedProject(db, { members: [member] });
		await db.insert(category).values({ id: 'c1', projectId: id, name: 'UI' });
		await db
			.insert(milestone)
			.values({ id: 'm1', projectId: id, name: 'v1', releaseDate: '2026-12-01' });
		const d = await getProjectDetail(ctxOf(base, admin), 'ACME');
		expect(d.key).toBe('ACME');
		expect(d.archived).toBe(false);
		expect(d.url).toBe('http://localhost:5173/projects/ACME');
		expect(d.timelineUrl).toBe('http://localhost:5173/projects/ACME/timeline');
		expect(d.statuses.length).toBeGreaterThan(0);
		expect(d.types.length).toBeGreaterThan(0);
		expect(d.categories).toEqual([{ id: 'c1', name: 'UI' }]);
		expect(d.milestones).toEqual([
			{ id: 'm1', name: 'v1', releaseDate: '2026-12-01', completed: false }
		]);
		expect(d.members.map((m) => m.name).sort()).toEqual(['Alice', 'Bob']);
		expect(JSON.stringify(d)).not.toContain('@');
	});

	it('一覧はキー・名前・アーカイブ・URL だけを返す', async () => {
		const admin = await seedUser(db, 'admin');
		await seedProject(db, { key: 'AAA', name: 'A', archived: true });
		const list = await listProjectSummaries(ctxOf(base, admin));
		expect(list).toEqual([
			{ key: 'AAA', name: 'A', archived: true, url: 'http://localhost:5173/projects/AAA' }
		]);
	});
});
