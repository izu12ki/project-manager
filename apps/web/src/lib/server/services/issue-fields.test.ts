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
	listMilestones,
	setMilestoneCompleted,
	updateCategory,
	updateMilestone
} from './issue-fields';
import { createIssue, getIssue, listBoard, listIssues, updateIssue } from './issues';

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
	it('管理者は名前・リリース日を編集でき、重複名は conflict', async () => {
		await createCategory(as(admin), 'ACME', { name: 'A' });
		await createCategory(as(admin), 'ACME', { name: 'B' });
		const [a] = await listCategories(as(admin), 'ACME');
		await expect(updateCategory(as(member), 'ACME', a.id, { name: 'X' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(updateCategory(as(admin), 'ACME', a.id, { name: 'B' })).rejects.toMatchObject({
			code: 'conflict'
		});
		await updateCategory(as(admin), 'ACME', a.id, { name: 'A' }); // 同名のままは成功
		await updateCategory(as(admin), 'ACME', a.id, { name: 'A2' });
		expect((await listCategories(as(admin), 'ACME')).map((c) => c.name)).toEqual(['A2', 'B']);

		await createMilestone(as(admin), 'ACME', { name: 'v1', releaseDate: '2026-11-30' });
		const [m] = await listMilestones(as(admin), 'ACME');
		await updateMilestone(as(admin), 'ACME', m.id, { name: 'v1.0', releaseDate: '' });
		expect((await listMilestones(as(admin), 'ACME'))[0]).toMatchObject({
			name: 'v1.0',
			releaseDate: null
		});
		// 他プロジェクトの ID は見つからない扱い
		await createCategory(as(admin), 'OTHER', { name: 'O' });
		const [o] = await listCategories(as(admin), 'OTHER');
		await expect(updateCategory(as(admin), 'ACME', o.id, { name: 'Z' })).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('完了したマイルストーンは新たに設定できないが、既存の課題の設定は残る', async () => {
		await createMilestone(as(admin), 'ACME', { name: 'v1' });
		const [m] = await listMilestones(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 'a', milestoneId: m.id });
		await createIssue(as(member), 'ACME', { title: 'b' });
		await expect(setMilestoneCompleted(as(member), 'ACME', m.id, true)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await setMilestoneCompleted(as(admin), 'ACME', m.id, true);
		expect((await listMilestones(as(admin), 'ACME'))[0].completedAt).toBeInstanceOf(Date);

		await updateIssue(as(member), 'ACME', 1, { title: 'a2', milestoneId: m.id });
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			title: 'a2',
			milestoneId: m.id
		});
		await expect(updateIssue(as(member), 'ACME', 2, { milestoneId: m.id })).rejects.toMatchObject({
			code: 'validation'
		});
		await expect(
			createIssue(as(member), 'ACME', { title: 'c', milestoneId: m.id })
		).rejects.toMatchObject({ code: 'validation' });

		await setMilestoneCompleted(as(admin), 'ACME', m.id, false);
		await updateIssue(as(member), 'ACME', 2, { milestoneId: m.id });
	});

	it('一覧・ボードをカテゴリー・マイルストーン・キーワードで絞り込める', async () => {
		await createCategory(as(admin), 'ACME', { name: 'C' });
		await createMilestone(as(admin), 'ACME', { name: 'M' });
		const [c] = await listCategories(as(admin), 'ACME');
		const [m] = await listMilestones(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 'ログイン画面', categoryId: c.id });
		await createIssue(as(member), 'ACME', { title: '100%_対応', milestoneId: m.id });
		await createIssue(as(member), 'ACME', { title: 'その他' });
		const nums = async (f: Parameters<typeof listIssues>[2]) =>
			(await listIssues(as(member), 'ACME', f)).map((i) => i.number);

		expect(await nums({ categoryId: c.id })).toEqual([1]);
		expect(await nums({ categoryId: 'none' })).toEqual([3, 2]);
		expect(await nums({ milestoneId: m.id })).toEqual([2]);
		expect(await nums({ milestoneId: 'none', categoryId: 'none' })).toEqual([3]);
		expect(await nums({ q: 'ログイン' })).toEqual([1]);
		expect(await nums({ q: '%' })).toEqual([2]); // LIKE のワイルドカードは文字として扱う
		expect(await nums({ q: '_' })).toEqual([2]);
		expect(await nums({ q: 'acme-3' })).toEqual([3]);
		expect(await nums({ q: '#1' })).toEqual([1]);

		const [row] = await listIssues(as(member), 'ACME', { q: 'ACME-2' });
		expect(row).toMatchObject({ milestoneName: 'M', categoryName: null });

		const board = await listBoard(as(member), 'ACME', { milestoneId: m.id });
		expect(board.todo.map((i) => i.number)).toEqual([2]);
	});
});
