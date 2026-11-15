import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	createCategory,
	createIssueType,
	createMilestone,
	createStatus,
	deleteCategory,
	deleteIssueType,
	deleteMilestone,
	deleteStatus,
	listCategories,
	listIssueTypes,
	listMilestones,
	listStatuses,
	moveIssueType,
	updateIssueType,
	moveStatus,
	updateStatus,
	setMilestoneCompleted,
	updateCategory,
	updateMilestone
} from './issue-fields';
import { createIssue, getIssue, listBoard, listIssues, updateIssue } from './issues';
import { eq } from 'drizzle-orm';
import { category, project } from '../db/schema';

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

	it('作成日時が同じカテゴリーは ID 順に並ぶ', async () => {
		const [p] = await db.select({ id: project.id }).from(project).where(eq(project.key, 'ACME'));
		const createdAt = new Date('2026-01-01T00:00:00Z');
		await db.insert(category).values({ id: '0192-b', projectId: p.id, name: 'A', createdAt });
		await db.insert(category).values({ id: '0192-a', projectId: p.id, name: 'B', createdAt });
		expect((await listCategories(as(member), 'ACME')).map((c) => c.id)).toEqual([
			'0192-a',
			'0192-b'
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
		await createMilestone(as(admin), 'ACME', { name: 'M', releaseDate: '2026-11-30' });
		const [m] = await listMilestones(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 't', milestoneId: m.id });
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({ milestoneId: m.id });

		await deleteMilestone(as(admin), 'ACME', m.id);
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({ milestoneId: null });
	});

	it('カテゴリーは複数設定でき、削除したカテゴリーだけ課題から外れる', async () => {
		await createCategory(as(admin), 'ACME', { name: 'A' });
		await createCategory(as(admin), 'ACME', { name: 'B' });
		await createCategory(as(admin), 'OTHER', { name: 'A' });
		const [a, b] = await listCategories(as(admin), 'ACME');
		const [otherA] = await listCategories(as(admin), 'OTHER');
		const categoryIdsOf = async (key: string) =>
			(await getIssue(as(member), key, 1)).issue.categoryIds;

		await createIssue(as(member), 'ACME', { title: 't', categoryIds: [b.id, a.id] });
		await createIssue(as(member), 'OTHER', { title: 't', categoryIds: [otherA.id] });
		expect(await categoryIdsOf('ACME')).toEqual([a.id, b.id]); // プロジェクトのカテゴリー順

		await deleteCategory(as(admin), 'ACME', a.id);
		expect(await categoryIdsOf('ACME')).toEqual([b.id]);
		expect(await categoryIdsOf('OTHER')).toEqual([otherA.id]);
		await deleteCategory(as(admin), 'ACME', b.id);
		expect(await categoryIdsOf('ACME')).toEqual([]);
	});

	it('categoryIds は重複を除き、[""]（画面で全部外したとき）や ""（API の null）で空にできる', async () => {
		await createCategory(as(admin), 'ACME', { name: 'A' });
		const [a] = await listCategories(as(admin), 'ACME');
		const categoryIds = async () => (await getIssue(as(member), 'ACME', 1)).issue.categoryIds;

		await createIssue(as(member), 'ACME', { title: 't', categoryIds: [a.id, a.id] });
		expect(await categoryIds()).toEqual([a.id]);
		await updateIssue(as(member), 'ACME', 1, { categoryIds: [''] });
		expect(await categoryIds()).toEqual([]);
		await updateIssue(as(member), 'ACME', 1, { categoryIds: [a.id] });
		await updateIssue(as(member), 'ACME', 1, { categoryIds: '' });
		expect(await categoryIds()).toEqual([]);
	});

	it('他プロジェクトのカテゴリー・マイルストーンは設定できない', async () => {
		await createCategory(as(admin), 'OTHER', { name: 'C' });
		await createMilestone(as(admin), 'OTHER', { name: 'M' });
		const [c] = await listCategories(as(admin), 'OTHER');
		const [m] = await listMilestones(as(admin), 'OTHER');
		await expect(
			createIssue(as(member), 'ACME', { title: 't', categoryIds: [c.id] })
		).rejects.toMatchObject({
			code: 'validation',
			fields: { categoryIds: ['カテゴリーが見つかりません'] }
		});
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
		await createCategory(as(admin), 'ACME', { name: 'C1' });
		await createCategory(as(admin), 'ACME', { name: 'C2' });
		await createMilestone(as(admin), 'ACME', { name: 'M' });
		const [c1, c2] = await listCategories(as(admin), 'ACME');
		const [m] = await listMilestones(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 'ログイン画面', categoryIds: [c1.id, c2.id] });
		await createIssue(as(member), 'ACME', {
			title: '100%_対応',
			categoryIds: [c2.id],
			milestoneId: m.id
		});
		await createIssue(as(member), 'ACME', { title: 'その他' });
		const nums = async (f: Parameters<typeof listIssues>[2]) =>
			(await listIssues(as(member), 'ACME', f)).map((i) => i.number);

		expect(await nums({ categoryId: c1.id })).toEqual([1]);
		expect(await nums({ categoryId: c2.id })).toEqual([2, 1]);
		expect(await nums({ categoryId: 'none' })).toEqual([3]);
		expect(await nums({ milestoneId: m.id })).toEqual([2]);
		expect(await nums({ milestoneId: 'none', categoryId: 'none' })).toEqual([3]);
		expect(await nums({ q: 'ログイン' })).toEqual([1]);
		expect(await nums({ q: '%' })).toEqual([2]); // LIKE のワイルドカードは文字として扱う
		expect(await nums({ q: '_' })).toEqual([2]);
		expect(await nums({ q: 'acme-3' })).toEqual([3]);
		expect(await nums({ q: '#1' })).toEqual([1]);

		const [row] = await listIssues(as(member), 'ACME', { q: 'ACME-1' });
		expect(row.categories).toEqual([
			{ id: c1.id, name: 'C1' },
			{ id: c2.id, name: 'C2' }
		]);
		const [row3] = await listIssues(as(member), 'ACME', { q: 'ACME-3' });
		expect(row3.categories).toEqual([]);

		const { columns: board } = await listBoard(as(member), 'ACME', { milestoneId: m.id });
		expect(board.todo.map((i) => i.number)).toEqual([2]);
		const { columns: byC1 } = await listBoard(as(member), 'ACME', { categoryId: c1.id });
		expect(byC1.todo.map((i) => i.number)).toEqual([1]);
	});

	it('カテゴリー名を変えると一覧の表示名も変わる', async () => {
		await createCategory(as(admin), 'ACME', { name: 'C' });
		const [c] = await listCategories(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 't', categoryIds: [c.id] });
		await updateCategory(as(admin), 'ACME', c.id, { name: 'C2' });
		expect((await listIssues(as(member), 'ACME'))[0].categories).toEqual([
			{ id: c.id, name: 'C2' }
		]);
	});

	describe('ステータス', () => {
		it('追加すると「完了」の直前に入り、ボードの列もその順になる', async () => {
			await createStatus(as(admin), 'ACME', { name: '保留', color: 'pink' });
			const names = (await listStatuses(as(member), 'ACME')).map((s) => s.name);
			expect(names).toEqual(['未着手', '進行中', 'レビュー', '保留', '完了']);
			const { statuses } = await listBoard(as(member), 'ACME');
			expect(statuses.map((s) => s.name)).toEqual(names);
			await expect(
				createStatus(as(admin), 'ACME', { name: '保留', color: 'pink' })
			).rejects.toMatchObject({ code: 'conflict' });
			await expect(
				createStatus(as(member), 'ACME', { name: 'X', color: 'pink' })
			).rejects.toMatchObject({ code: 'forbidden' });
		});

		it('追加したステータスに課題を移せ、削除するとその課題は未着手の末尾に移る', async () => {
			await createStatus(as(admin), 'ACME', { name: '保留', color: 'pink' });
			const hold = (await listStatuses(as(admin), 'ACME')).find((s) => s.name === '保留')!;
			await createIssue(as(member), 'ACME', { title: 'A' });
			await createIssue(as(member), 'ACME', { title: 'B', status: hold.key });
			await updateIssue(as(member), 'ACME', 1, { status: hold.key });
			await createIssue(as(member), 'ACME', { title: 'C' });
			await deleteStatus(as(admin), 'ACME', hold.key);
			const { columns } = await listBoard(as(member), 'ACME');
			expect(columns.todo.map((i) => i.title)).toEqual(['C', 'B', 'A']);
			expect(columns[hold.key]).toBeUndefined();
		});

		it('未着手と完了は削除できない。名前と色は変えられる', async () => {
			for (const key of ['todo', 'done']) {
				await expect(deleteStatus(as(admin), 'ACME', key)).rejects.toMatchObject({
					code: 'validation'
				});
			}
			await updateStatus(as(admin), 'ACME', 'done', { name: '終了', color: 'teal' });
			const done = (await listStatuses(as(member), 'ACME')).find((s) => s.key === 'done');
			expect(done).toEqual({ key: 'done', name: '終了', color: 'teal' });
		});

		it('並び順を入れ替えられる', async () => {
			await moveStatus(as(admin), 'ACME', 'done', -1);
			await moveStatus(as(admin), 'ACME', 'todo', -1); // 先頭はそのまま
			expect((await listStatuses(as(member), 'ACME')).map((s) => s.key)).toEqual([
				'todo',
				'in_progress',
				'done',
				'in_review'
			]);
		});

		it('他のプロジェクトのステータスは使えない', async () => {
			await createStatus(as(admin), 'OTHER', { name: '保留', color: 'pink' });
			const hold = (await listStatuses(as(admin), 'OTHER')).find((s) => s.name === '保留')!;
			await expect(
				createIssue(as(member), 'ACME', { title: 'A', status: hold.key })
			).rejects.toMatchObject({ code: 'validation' });
		});
	});

	describe('課題種別', () => {
		it('追加・並べ替え・削除。削除すると課題の種別は未設定になる', async () => {
			await createIssueType(as(admin), 'ACME', { name: '調査', color: 'amber' });
			let types = await listIssueTypes(as(member), 'ACME');
			expect(types.map((t) => t.name)).toEqual(['タスク', 'バグ', '要望', 'その他', '調査']);
			const research = types[4];
			await moveIssueType(as(admin), 'ACME', research.id, -1);
			types = await listIssueTypes(as(member), 'ACME');
			expect(types.map((t) => t.name)).toEqual(['タスク', 'バグ', '要望', '調査', 'その他']);

			await createIssue(as(member), 'ACME', { title: 'A', typeId: research.id });
			await deleteIssueType(as(admin), 'ACME', research.id);
			expect((await getIssue(as(member), 'ACME', 1)).issue.typeId).toBeNull();
			await expect(
				createIssueType(as(admin), 'ACME', { name: 'タスク', color: 'blue' })
			).rejects.toMatchObject({ code: 'conflict' });
			await expect(
				createIssueType(as(member), 'ACME', { name: 'X', color: 'blue' })
			).rejects.toMatchObject({ code: 'forbidden' });
		});

		it('本文テンプレートを設定でき、名前・色だけの更新では消えない', async () => {
			const [task] = await listIssueTypes(as(admin), 'ACME');
			expect(task.template).toBe('');
			await updateIssueType(as(admin), 'ACME', task.id, {
				name: 'タスク',
				color: 'blue',
				template: '## 背景\r\n\r\n## やること'
			});
			await updateIssueType(as(admin), 'ACME', task.id, { name: '作業', color: 'blue' });
			const [updated] = await listIssueTypes(as(admin), 'ACME');
			expect(updated).toMatchObject({ name: '作業', template: '## 背景\n\n## やること' });
		});

		it('他のプロジェクトの種別は設定できない', async () => {
			const [other] = await listIssueTypes(as(admin), 'OTHER');
			await expect(
				createIssue(as(member), 'ACME', { title: 'A', typeId: other.id })
			).rejects.toMatchObject({ code: 'validation' });
		});
	});
});
