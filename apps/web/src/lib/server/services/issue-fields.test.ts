import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	createCategory,
	createMilestone,
	deleteCategory,
	deleteMilestone,
	listCategories,
	listMilestones
} from './issue-fields';
import { createIssue, getIssue, updateIssue } from './issues';

describe('issue-fields', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		await seedProject(db, { key: 'ACME', members: [member] });
		await seedProject(db, { key: 'OTHER', members: [member] });
	});

	it('管理者だけがカテゴリー・マイルストーンを追加できる', async () => {
		await createCategory(as(admin), 'ACME', { name: 'フロントエンド' });
		await expect(createCategory(as(member), 'ACME', { name: 'X' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(createMilestone(as(member), 'ACME', { name: 'v1' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		expect((await listCategories(as(member), 'ACME')).map((c) => c.name)).toEqual([
			'フロントエンド'
		]);
	});

	it('同じプロジェクトで名前は重複できない', async () => {
		await createCategory(as(admin), 'ACME', { name: 'A' });
		await expect(createCategory(as(admin), 'ACME', { name: ' A ' })).rejects.toMatchObject({
			code: 'conflict'
		});
		await createCategory(as(admin), 'OTHER', { name: 'A' });
	});

	it('マイルストーンはリリース日順、日付なしは最後', async () => {
		await createMilestone(as(admin), 'ACME', { name: 'バックログ', releaseDate: '' });
		await createMilestone(as(admin), 'ACME', { name: 'v1.1', releaseDate: '2026-12-20' });
		await createMilestone(as(admin), 'ACME', { name: 'v1.0', releaseDate: '2026-11-30' });
		expect((await listMilestones(as(member), 'ACME')).map((m) => m.name)).toEqual([
			'v1.0',
			'v1.1',
			'バックログ'
		]);
	});

	it('課題に設定でき、削除すると課題側は未設定に戻る', async () => {
		await createCategory(as(admin), 'ACME', { name: 'C' });
		await createMilestone(as(admin), 'ACME', { name: 'M', releaseDate: '2026-11-30' });
		const [c] = await listCategories(as(admin), 'ACME');
		const [m] = await listMilestones(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 't', categoryId: c.id, milestoneId: m.id });
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			categoryId: c.id,
			milestoneId: m.id
		});

		await deleteCategory(as(admin), 'ACME', c.id);
		await deleteMilestone(as(admin), 'ACME', m.id);
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			categoryId: null,
			milestoneId: null
		});
	});

	it('他プロジェクトのカテゴリー・マイルストーンは設定できない', async () => {
		await createCategory(as(admin), 'OTHER', { name: 'C' });
		await createMilestone(as(admin), 'OTHER', { name: 'M' });
		const [c] = await listCategories(as(admin), 'OTHER');
		const [m] = await listMilestones(as(admin), 'OTHER');
		await expect(
			createIssue(as(member), 'ACME', { title: 't', categoryId: c.id })
		).rejects.toMatchObject({ code: 'validation' });
		await createIssue(as(member), 'ACME', { title: 't' });
		await expect(updateIssue(as(member), 'ACME', 1, { milestoneId: m.id })).rejects.toMatchObject({
			code: 'validation'
		});
	});
});
