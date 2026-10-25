import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { category, milestone } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	getApiIssue,
	getProjectDetail,
	listApiIssues,
	listProjectSummaries,
	toServiceInput
} from './api-views';
import { createIssue, deleteIssue, listIssueChanges, updateIssue } from './issues';

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

describe('api issues', () => {
	it('limit/offset でページングでき、total は絞り込み後の件数', async () => {
		const admin = await seedUser(db, 'admin');
		await seedProject(db);
		const ctx = ctxOf(base, admin);
		for (const title of ['a', 'b', 'c']) await createIssue(ctx, 'ACME', { title });
		await createIssue(ctx, 'ACME', { title: 'x', priority: 'high' });
		const page = await listApiIssues(ctx, 'ACME', new URLSearchParams('limit=2&offset=1'));
		expect(page.total).toBe(4);
		expect(page.limit).toBe(2);
		expect(page.offset).toBe(1);
		expect(page.items.map((i) => i.key)).toEqual(['ACME-3', 'ACME-2']);
		const filtered = await listApiIssues(ctx, 'ACME', new URLSearchParams('q=x&limit=1'));
		expect(filtered.total).toBe(1);
		expect(filtered.items[0].url).toBe('http://localhost:5173/projects/ACME/issues/4');
		expect(JSON.stringify(page)).not.toContain('@');
	});

	it('limit=1000 は validation', async () => {
		const admin = await seedUser(db, 'admin');
		await seedProject(db);
		await expect(
			listApiIssues(ctxOf(base, admin), 'ACME', new URLSearchParams('limit=1000'))
		).rejects.toMatchObject({ code: 'validation', fields: { limit: expect.any(Array) } });
	});

	it('削除済み課題の取得は not_found', async () => {
		const admin = await seedUser(db, 'admin');
		await seedProject(db);
		const ctx = ctxOf(base, admin);
		await createIssue(ctx, 'ACME', { title: 'a' });
		expect((await getApiIssue(ctx, 'ACME', 1)).description).toBe('');
		await deleteIssue(ctx, 'ACME', 1);
		await expect(getApiIssue(ctx, 'ACME', 1)).rejects.toMatchObject({ code: 'not_found' });
	});

	it("toServiceInput は null を '' にし、undefined のキーは残さない", () => {
		expect(toServiceInput({ dueDate: null, title: 'a', x: undefined })).toEqual({
			dueDate: '',
			title: 'a'
		});
		expect(toServiceInput('str')).toBe('str');
	});

	it('PATCH で dueDate: null を送ると期限が空になり、変更履歴の actor がキーの持ち主', async () => {
		const admin = await seedUser(db, 'admin');
		await seedProject(db);
		const ctx = ctxOf(base, admin);
		await createIssue(ctx, 'ACME', { title: 'a', dueDate: '2026-12-31' });
		await updateIssue(ctx, 'ACME', 1, toServiceInput({ dueDate: null }));
		expect((await getApiIssue(ctx, 'ACME', 1)).dueDate).toBeNull();
		const changes = await listIssueChanges(ctx, 'ACME', 1);
		expect(changes.at(-1)?.actorId).toBe(admin.id);
	});
});
