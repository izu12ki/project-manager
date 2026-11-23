import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { eq, sql } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { project as projectTable, issue as issueTable, user as userTable } from '../db/schema';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import {
	createIssue,
	deleteIssue,
	getIssue,
	listBoard,
	listDeletedIssues,
	listIssueChanges,
	listIssues,
	listTimeline,
	moveIssue,
	updateIssue
} from './issues';
import { getIssueDetailRows } from './issue-detail';
import { createCategory, listCategories, listIssueTypes } from './issue-fields';
import { categoryIdsValue } from './issue-input';
import { requireProject, setProjectArchived } from './projects';

describe('issues', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, guest2: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		guest2 = await seedUser(db, 'guest', 'guest2');
		await seedProject(db, { key: 'ACME', members: [member, guest, guest2] });
	});

	it('起票すると連番が振られ、todo の末尾に入る', async () => {
		expect(await createIssue(as(guest), 'ACME', { title: 'A' })).toEqual({ number: 1 });
		expect(
			await createIssue(as(member), 'ACME', { title: 'B', priority: 'high', dueDate: '2026-12-31' })
		).toEqual({ number: 2 });
		const { columns: board } = await listBoard(as(member), 'ACME');
		expect(board.todo.map((i) => i.number)).toEqual([1, 2]);
		const { issue } = await getIssue(as(member), 'ACME', 2);
		expect(issue).toMatchObject({
			priority: 'high',
			dueDate: '2026-12-31',
			status: 'todo',
			reporterId: member.id
		});
	});

	it('起票時にステータス・開始日を指定でき、開始日は期限日以前に限る', async () => {
		await createIssue(as(member), 'ACME', {
			title: 'A',
			status: 'in_progress',
			startDate: '2026-10-06',
			dueDate: '2026-10-10'
		});
		const { columns: board } = await listBoard(as(member), 'ACME');
		expect(board.in_progress.map((i) => i.number)).toEqual([1]);
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			startDate: '2026-10-06'
		});
		await expect(
			createIssue(as(member), 'ACME', {
				title: 'B',
				startDate: '2026-10-11',
				dueDate: '2026-10-10'
			})
		).rejects.toMatchObject({ code: 'validation' });
		await expect(
			updateIssue(as(member), 'ACME', 1, { startDate: '2026-10-11' })
		).rejects.toMatchObject({ code: 'validation' });
		// 形式が合っていても暦にない日付は保存しない
		await expect(
			updateIssue(as(member), 'ACME', 1, { dueDate: '2027-02-29' })
		).rejects.toMatchObject({ code: 'validation', message: '日付の形式が正しくありません' });
		await expect(
			createIssue(as(member), 'ACME', { title: 'C', status: 'bogus' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('同時に起票しても番号が重複しない', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) => createIssue(as(member), 'ACME', { title: `T${i}` }))
		);
		expect(results.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('ゲストも起票時に担当者とステータスを指定できる', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A', assigneeIds: [member.id], status: 'done' });
		expect((await getIssue(as(guest), 'ACME', 1)).issue).toMatchObject({
			assigneeIds: [member.id],
			status: 'done'
		});
	});

	it('参加者でない人は担当者にできない', async () => {
		const outsider = await seedUser(db, 'member', 'outsider');
		await expect(
			createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [outsider.id] })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('ゲストは他の人が起票した課題も編集できる', async () => {
		await createIssue(as(guest), 'ACME', { title: 'mine' });
		await createIssue(as(member), 'ACME', { title: 'theirs' });
		await updateIssue(as(guest), 'ACME', 1, {
			title: 'mine2',
			description: 'd',
			priority: 'low',
			dueDate: ''
		});
		expect((await getIssue(as(guest), 'ACME', 1)).issue).toMatchObject({
			title: 'mine2',
			description: 'd',
			priority: 'low',
			dueDate: null
		});
		await updateIssue(as(guest), 'ACME', 2, { title: 'x' });
		await updateIssue(as(guest2), 'ACME', 1, { title: 'y' });
		expect((await getIssue(as(guest), 'ACME', 2)).issue.title).toBe('x');
		expect((await getIssue(as(guest), 'ACME', 1)).issue.title).toBe('y');
	});

	it('値が変わっていない項目は権限チェックしない（フォームが全項目を送るため）', async () => {
		await createIssue(as(member), 'ACME', { title: 'theirs', assigneeIds: [guest.id] });
		await updateIssue(as(guest), 'ACME', 1, {
			title: 'theirs',
			status: 'in_progress',
			assigneeIds: [guest.id]
		});
		expect((await getIssue(as(guest), 'ACME', 1)).issue.status).toBe('in_progress');
	});

	it('担当者が後から無効化されても、同じ担当者のままステータスを変更できる', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		await updateIssue(as(member), 'ACME', 1, { status: 'done', assigneeIds: [guest.id] });
		const { issue } = await getIssue(as(member), 'ACME', 1);
		expect(issue).toMatchObject({ status: 'done', assigneeIds: [guest.id] });
		await expect(
			updateIssue(as(member), 'ACME', 1, { assigneeIds: [guest2.id] })
		).resolves.not.toThrow();
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		await expect(
			updateIssue(as(member), 'ACME', 1, { assigneeIds: [guest.id] })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('ゲストも担当外の課題のステータスと担当者を変えられる', async () => {
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(guest), 'ACME', 1, { status: 'done', assigneeIds: [guest2.id] });
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			status: 'done',
			assignees: [{ id: guest2.id, name: 'guest2' }]
		});
	});

	it('ステータスを変えると移動先の列の末尾に入る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(member), 'ACME', 2, { status: 'done' });
		await updateIssue(as(member), 'ACME', 1, { status: 'done' });
		expect((await listBoard(as(member), 'ACME')).columns.done.map((i) => i.number)).toEqual([2, 1]);
	});

	it('カンバン移動: 前後の課題の間に入る', async () => {
		for (const t of ['A', 'B', 'C']) await createIssue(as(member), 'ACME', { title: t });
		const ids = (await listBoard(as(member), 'ACME')).columns.todo.map((i) => i.id);
		// C を A と B の間へ
		await moveIssue(as(member), 'ACME', {
			issueId: ids[2],
			status: 'todo',
			beforeId: ids[0],
			afterId: ids[1]
		});
		expect((await listBoard(as(member), 'ACME')).columns.todo.map((i) => i.title)).toEqual([
			'A',
			'C',
			'B'
		]);
		// B を in_review の空の列へ
		await moveIssue(as(member), 'ACME', {
			issueId: ids[1],
			status: 'in_review',
			beforeId: '',
			afterId: ''
		});
		const { columns: board } = await listBoard(as(member), 'ACME');
		expect(board.in_review.map((i) => i.title)).toEqual(['B']);
		expect(board.todo.map((i) => i.title)).toEqual(['A', 'C']);
	});

	it('カンバン移動: 隣接 ID が別の列のもの（古い画面）なら validation', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		const [a, b] = (await listBoard(as(member), 'ACME')).columns.todo;
		await updateIssue(as(member), 'ACME', b.number, { status: 'done' });
		await expect(
			moveIssue(as(member), 'ACME', { issueId: a.id, status: 'todo', beforeId: b.id, afterId: '' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('カンバン移動: ゲストも担当外の課題を動かせる。存在しないステータスへは動かせない', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const [a] = (await listBoard(as(member), 'ACME')).columns.todo;
		await moveIssue(as(guest), 'ACME', {
			issueId: a.id,
			status: 'done',
			beforeId: '',
			afterId: ''
		});
		expect((await listBoard(as(member), 'ACME')).columns.done.map((i) => i.id)).toEqual([a.id]);
		await expect(
			moveIssue(as(guest), 'ACME', { issueId: a.id, status: 'bogus', beforeId: '', afterId: '' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('一覧の絞り込み', async () => {
		await createIssue(as(member), 'ACME', {
			title: 'A',
			assigneeIds: [guest.id],
			priority: 'high'
		});
		await createIssue(as(member), 'ACME', { title: 'B' });
		expect((await listIssues(as(member), 'ACME')).map((i) => i.number)).toEqual([2, 1]);
		expect(
			(await listIssues(as(member), 'ACME', { assigneeId: 'none' })).map((i) => i.number)
		).toEqual([2]);
		expect(
			(await listIssues(as(member), 'ACME', { assigneeId: guest.id })).map((i) => i.number)
		).toEqual([1]);
		expect(
			(await listIssues(as(member), 'ACME', { priority: 'high' })).map((i) => i.number)
		).toEqual([1]);
		expect(await listIssues(as(member), 'ACME', { status: 'done' })).toHaveLength(0);
	});

	it('一覧の並べ替え: 日付が空の課題はどちらの向きでも末尾。絞り込みと併用できる', async () => {
		await createIssue(as(member), 'ACME', {
			title: 'A',
			startDate: '2026-12-10',
			priority: 'high'
		});
		await createIssue(as(member), 'ACME', { title: 'B', priority: 'high' });
		await createIssue(as(member), 'ACME', {
			title: 'C',
			startDate: '2026-12-01',
			dueDate: '2026-12-20'
		});
		await createIssue(as(member), 'ACME', {
			title: 'D',
			startDate: '2026-12-01',
			priority: 'high'
		});
		// 登録日は番号と逆にする（Backlog から取り込んだ課題は番号順とは限らない）
		const at = (day: number) => new Date(Date.UTC(2026, 10, day));
		for (const [n, created, updated] of [
			[1, 20, 21],
			[2, 15, 23],
			[3, 10, 22],
			[4, 5, 20]
		]) {
			await db
				.update(issueTable)
				.set({ createdAt: at(created), updatedAt: at(updated) })
				.where(eq(issueTable.number, n));
		}
		const numbers = async (
			sort: Parameters<typeof listIssues>[3],
			filters: Parameters<typeof listIssues>[2] = {}
		) => (await listIssues(as(member), 'ACME', filters, sort)).map((i) => i.number);

		expect(await numbers(undefined)).toEqual([4, 3, 2, 1]);
		expect(await numbers({ key: 'number', order: 'asc' })).toEqual([1, 2, 3, 4]);
		// 同じ開始日の中はキーの降順
		expect(await numbers({ key: 'start', order: 'asc' })).toEqual([4, 3, 1, 2]);
		expect(await numbers({ key: 'start', order: 'desc' })).toEqual([1, 4, 3, 2]);
		expect(await numbers({ key: 'due', order: 'asc' })).toEqual([3, 4, 2, 1]);
		expect(await numbers({ key: 'created', order: 'desc' })).toEqual([1, 2, 3, 4]);
		expect(await numbers({ key: 'created', order: 'asc' })).toEqual([4, 3, 2, 1]);
		expect(await numbers({ key: 'updated', order: 'desc' })).toEqual([2, 3, 1, 4]);
		expect(await numbers({ key: 'start', order: 'asc' }, { priority: 'high' })).toEqual([4, 1, 2]);
		const [row] = await listIssues(as(member), 'ACME', { q: 'ACME-1' });
		expect(row).toMatchObject({ createdAt: at(20), updatedAt: at(21), startDate: '2026-12-10' });
	});

	it('キーワードは件名の部分一致。長い日本語でも探せ、% と _ は文字として扱い、英字の大小は区別しない', async () => {
		const long =
			'会員登録画面で住所の入力欄が郵便番号から自動で埋まらない不具合について調査して修正する';
		await createIssue(as(member), 'ACME', { title: long });
		await createIssue(as(member), 'ACME', { title: '進捗 100%_done' });
		await createIssue(as(member), 'ACME', { title: 'Login Bug' });
		await createIssue(as(member), 'ACME', { title: '進捗 1000 done' });
		const titles = async (q: string) =>
			(await listIssues(as(member), 'ACME', { q })).map((i) => i.title);

		expect(await titles(long.slice(2, 40))).toEqual([long]);
		expect(await titles('%_')).toEqual(['進捗 100%_done']);
		expect(await titles('login')).toEqual(['Login Bug']);
	});

	it('削除はメンバー以上。ゲストは不可', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await expect(deleteIssue(as(guest), 'ACME', 1)).rejects.toMatchObject({ code: 'forbidden' });
		await deleteIssue(as(member), 'ACME', 1);
	});

	it('削除した課題は一覧から消え、削除履歴として閲覧だけできる', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await deleteIssue(as(member), 'ACME', 1);
		expect((await listIssues(as(guest), 'ACME')).map((i) => i.number)).toEqual([2]);
		expect((await listBoard(as(guest), 'ACME')).columns.todo.map((i) => i.number)).toEqual([2]);
		expect(await listDeletedIssues(as(guest), 'ACME')).toMatchObject([
			{ number: 1, title: 'A', deletedByName: 'member' }
		]);
		const { issue } = await getIssue(as(guest), 'ACME', 1);
		expect(issue.deletedAt).toBeInstanceOf(Date);
		expect(issue.deletedByName).toBe('member');
		await expect(updateIssue(as(member), 'ACME', 1, { title: 'x' })).rejects.toMatchObject({
			code: 'conflict'
		});
		await expect(deleteIssue(as(member), 'ACME', 1)).rejects.toMatchObject({ code: 'conflict' });
		// 番号は再利用しない
		expect(await createIssue(as(member), 'ACME', { title: 'C' })).toEqual({ number: 3 });
	});

	it('種別と完了理由を設定できる', async () => {
		const types = await listIssueTypes(as(member), 'ACME');
		expect(types.map((t) => t.name)).toEqual(['タスク', 'バグ', '要望', 'その他']);
		await createIssue(as(guest), 'ACME', { title: 'A', typeId: types[1].id });
		await updateIssue(as(guest), 'ACME', 1, { resolution: 'duplicate' });
		expect((await listIssues(as(member), 'ACME'))[0]).toMatchObject({
			typeName: 'バグ',
			resolution: 'duplicate'
		});
		await updateIssue(as(member), 'ACME', 1, { resolution: '', typeId: types[0].id });
		expect((await getIssue(as(member), 'ACME', 1)).issue).toMatchObject({
			resolution: null,
			typeId: types[0].id
		});
		await expect(updateIssue(as(member), 'ACME', 1, { resolution: 'bogus' })).rejects.toMatchObject(
			{ code: 'validation' }
		);
		await expect(updateIssue(as(member), 'ACME', 1, { typeId: 'nope' })).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('編集すると、変わった項目が変更時点の表示名で履歴に残る', async () => {
		const types = await listIssueTypes(as(member), 'ACME');
		await createIssue(as(member), 'ACME', { title: 'A', typeId: types[0].id });
		expect(await listIssueChanges(as(member), 'ACME', 1)).toEqual([]);
		await updateIssue(as(guest), 'ACME', 1, {
			title: 'B',
			description: '本文',
			typeId: types[1].id,
			status: 'in_progress',
			priority: 'high',
			assigneeIds: [member.id],
			dueDate: '2026-12-31'
		});
		// 何も変わらない保存は残さない
		await updateIssue(as(guest), 'ACME', 1, { title: 'B', priority: 'high' });
		const changes = await listIssueChanges(as(member), 'ACME', 1);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ actorId: guest.id, actorName: 'guest' });
		expect(changes[0].changes).toEqual([
			{ field: 'title', from: 'A', to: 'B' },
			{ field: 'description', from: '', to: '本文' },
			{ field: 'type', from: 'タスク', to: 'バグ' },
			{ field: 'status', from: '未着手', to: '進行中' },
			{ field: 'priority', from: 'なし', to: '高' },
			{ field: 'assignee', from: null, to: 'member' },
			{ field: 'dueDate', from: null, to: '2026-12-31' }
		]);
	});

	it('カテゴリーの変更は前後の全カテゴリー名で残り、並び順だけの違いは変更にならない', async () => {
		await createCategory(as(admin), 'ACME', { name: 'A' });
		await createCategory(as(admin), 'ACME', { name: 'B' });
		const [a, b] = await listCategories(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', { title: 'A', categoryIds: [a.id] });
		await updateIssue(as(member), 'ACME', 1, { categoryIds: [a.id, b.id] });
		await updateIssue(as(member), 'ACME', 1, { categoryIds: [b.id, a.id] }); // 変化なし
		await updateIssue(as(member), 'ACME', 1, { categoryIds: [] });
		const changes = await listIssueChanges(as(member), 'ACME', 1);
		expect(changes.map((c) => c.changes)).toEqual([
			[{ field: 'category', from: 'A', to: 'A、B' }],
			[{ field: 'category', from: 'A、B', to: null }]
		]);
	});

	describe('複数担当者', () => {
		it('指定した順で保存し、重複と空文字は除く。一覧の絞り込みはその人を含む課題', async () => {
			await createIssue(as(member), 'ACME', {
				title: 'A',
				assigneeIds: [guest.id, member.id, guest.id, '']
			});
			await createIssue(as(member), 'ACME', { title: 'B', assigneeIds: [member.id] });
			await createIssue(as(member), 'ACME', { title: 'C' });
			expect((await getIssue(as(member), 'ACME', 1)).issue.assignees).toEqual([
				{ id: guest.id, name: 'guest' },
				{ id: member.id, name: 'member' }
			]);
			const numbers = async (assigneeId: string) =>
				(await listIssues(as(member), 'ACME', { assigneeId })).map((i) => i.number);
			expect(await numbers(member.id)).toEqual([2, 1]);
			expect(await numbers(guest.id)).toEqual([1]);
			expect(await numbers('none')).toEqual([3]);
		});

		it('履歴は「、」区切りの名前。並び順だけ変えても変更とみなす', async () => {
			await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [member.id] });
			await updateIssue(as(member), 'ACME', 1, { assigneeIds: [member.id, guest.id] });
			await updateIssue(as(member), 'ACME', 1, { assigneeIds: [] });
			const changes = await listIssueChanges(as(member), 'ACME', 1);
			expect(changes.map((c) => c.changes)).toEqual([
				[{ field: 'assignee', from: 'member', to: 'member、guest' }],
				[{ field: 'assignee', from: 'member、guest', to: null }]
			]);
		});

		it('担当者は 10 人まで', async () => {
			await expect(
				createIssue(as(member), 'ACME', {
					title: 'A',
					assigneeIds: Array.from({ length: 11 }, (_, i) => `u${i}`)
				})
			).rejects.toMatchObject({ code: 'validation' });
		});

		it('無効化された元の担当者は残したまま、ほかの人を足せる', async () => {
			await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
			await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
			await updateIssue(as(member), 'ACME', 1, { assigneeIds: [guest.id, guest2.id] });
			expect((await getIssue(as(member), 'ACME', 1)).issue.assigneeIds).toEqual([
				guest.id,
				guest2.id
			]);
		});
	});

	describe('子課題', () => {
		it('起票時に親課題を番号か課題キーで指定でき、親から子課題を番号順に引ける', async () => {
			await createIssue(as(member), 'ACME', { title: '親' });
			await createIssue(as(member), 'ACME', { title: '子1', parentNumber: '1' });
			await createIssue(as(guest), 'ACME', { title: '子2', parentNumber: 'ACME-1' });
			const { children } = await getIssueDetailRows(as(member), 'ACME', 1);
			expect(children.map((i) => i.number)).toEqual([2, 3]);
			const { issue: child } = await getIssue(as(member), 'ACME', 2);
			expect(child.parent).toEqual({ number: 1, title: '親' });
			expect((await listIssues(as(member), 'ACME')).find((i) => i.number === 3)).toMatchObject({
				parentNumber: 1
			});
		});

		it('子課題は 1 階層まで。自分自身・存在しない課題・削除した課題は親にできない', async () => {
			await createIssue(as(member), 'ACME', { title: '親' });
			await createIssue(as(member), 'ACME', { title: '子', parentNumber: 1 });
			await createIssue(as(member), 'ACME', { title: '単独' });
			await createIssue(as(member), 'ACME', { title: '削除' });
			await deleteIssue(as(member), 'ACME', 4);
			const fails = (p: Promise<unknown>) =>
				expect(p).rejects.toMatchObject({ code: 'validation' });
			await fails(createIssue(as(member), 'ACME', { title: '孫', parentNumber: 2 }));
			await fails(updateIssue(as(member), 'ACME', 3, { parentNumber: 2 }));
			await fails(updateIssue(as(member), 'ACME', 1, { parentNumber: 3 }));
			await fails(updateIssue(as(member), 'ACME', 3, { parentNumber: 3 }));
			await fails(updateIssue(as(member), 'ACME', 3, { parentNumber: 99 }));
			await fails(updateIssue(as(member), 'ACME', 3, { parentNumber: 4 }));
			await fails(updateIssue(as(member), 'ACME', 3, { parentNumber: 'abc' }));
		});

		it('親の付け替え・解除は履歴に残る', async () => {
			await createIssue(as(member), 'ACME', { title: '親A' });
			await createIssue(as(member), 'ACME', { title: '親B' });
			await createIssue(as(member), 'ACME', { title: '子', parentNumber: 1 });
			await updateIssue(as(member), 'ACME', 3, { parentNumber: '2' });
			// 同じ親のままなら変更しない
			await updateIssue(as(member), 'ACME', 3, { parentNumber: '2' });
			await updateIssue(as(member), 'ACME', 3, { parentNumber: '' });
			const changes = await listIssueChanges(as(member), 'ACME', 3);
			expect(changes.map((c) => c.changes)).toEqual([
				[{ field: 'parent', from: '#1 親A', to: '#2 親B' }],
				[{ field: 'parent', from: '#2 親B', to: null }]
			]);
		});

		it('親課題を削除すると、子課題は残り親子関係だけ外れる', async () => {
			await createIssue(as(member), 'ACME', { title: '親' });
			await createIssue(as(member), 'ACME', { title: '子', parentNumber: 1 });
			await deleteIssue(as(member), 'ACME', 1);
			const { issue: child } = await getIssue(as(member), 'ACME', 2);
			expect(child).toMatchObject({ parentId: null, parent: null, deletedAt: null });
		});
	});

	it('カンバン移動: 列が変わったときだけ履歴に残る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const { id: a } = (await getIssue(as(member), 'ACME', 1)).issue;
		await createIssue(as(member), 'ACME', { title: 'B' });
		await moveIssue(as(member), 'ACME', { issueId: a, status: 'todo', beforeId: undefined });
		expect(await listIssueChanges(as(member), 'ACME', 1)).toEqual([]);
		await moveIssue(as(member), 'ACME', { issueId: a, status: 'done' });
		const changes = await listIssueChanges(as(member), 'ACME', 1);
		expect(changes.map((c) => c.changes)).toEqual([
			[{ field: 'status', from: '未着手', to: '完了' }]
		]);
	});

	describe('削除済みのカテゴリー ID', () => {
		async function setup() {
			await createCategory(as(admin), 'ACME', { name: 'c1' });
			await createCategory(as(admin), 'ACME', { name: 'c2' });
			await seedProject(db, { key: 'OTHER' });
			await createCategory(as(admin), 'OTHER', { name: 'o1' });
			const [c1, c2] = (await listCategories(as(admin), 'ACME')).map((c) => c.id);
			const [o1] = (await listCategories(as(admin), 'OTHER')).map((c) => c.id);
			const [p] = await db
				.select({ id: projectTable.id })
				.from(projectTable)
				.where(eq(projectTable.key, 'ACME'));
			return { c1, c2, o1, projectId: p.id };
		}
		const categoriesOf = async (id: string) =>
			(
				await db
					.select({ categoryIds: issueTable.categoryIds })
					.from(issueTable)
					.where(eq(issueTable.id, id))
			)[0].categoryIds;
		const insertIssue = (projectId: string, id: string, number: number, categoryIds: unknown) =>
			db.insert(issueTable).values({
				id,
				projectId,
				number,
				title: id,
				reporterId: admin.id,
				position: `a${number}`,
				categoryIds: categoryIds as string[]
			});

		it('書き込む時点でないカテゴリーは課題に残さない', async () => {
			const { c1, c2, o1, projectId } = await setup();
			await insertIssue(projectId, 'i1', 1, categoryIdsValue(projectId, [c1, 'gone', o1, c2]));
			await insertIssue(projectId, 'i2', 2, categoryIdsValue(projectId, ['gone']));
			await insertIssue(projectId, 'i3', 3, categoryIdsValue(projectId, []));
			expect(await categoriesOf('i1')).toEqual([c1, c2]);
			expect(await categoriesOf('i2')).toEqual([]);
			expect(await categoriesOf('i3')).toEqual([]);
		});

		it('マイグレーションで、存在しないカテゴリー ID を課題から外す', async () => {
			const { c1, c2, o1, projectId } = await setup();
			const updatedAt = new Date('2026-01-01T00:00:00Z');
			await insertIssue(projectId, 'i1', 1, [c1, 'gone', o1]);
			await insertIssue(projectId, 'i2', 2, [c2, c1]);
			await insertIssue(projectId, 'i3', 3, []);
			await db.update(issueTable).set({ updatedAt });
			const dir = fileURLToPath(new URL('../../../../drizzle', import.meta.url));
			const name = readdirSync(dir).find((d) => d.endsWith('_issue_category_ids_cleanup'));
			expect(name).toBeDefined();
			await db.run(sql.raw(readFileSync(`${dir}/${name}/migration.sql`, 'utf8')));
			expect(await categoriesOf('i1')).toEqual([c1]);
			expect(await categoriesOf('i2')).toEqual([c2, c1]);
			expect(await categoriesOf('i3')).toEqual([]);
			const rows = await db.select({ updatedAt: issueTable.updatedAt }).from(issueTable);
			expect(rows.every((r) => r.updatedAt.getTime() === updatedAt.getTime())).toBe(true);
		});
	});

	it('アンダースコアを含むキーでも課題キー（web_app-2）で検索できる', async () => {
		await seedProject(db, { key: 'WEB_APP', members: [member] });
		await createIssue(as(member), 'WEB_APP', { title: 'one' });
		await createIssue(as(member), 'WEB_APP', { title: 'two' });
		const found = await listIssues(as(member), 'WEB_APP', { q: 'web_app-2' });
		expect(found.map((i) => i.number)).toEqual([2]);
	});

	it('別プロジェクトの課題は番号を推測しても見えない', async () => {
		await seedProject(db, { key: 'OTHER' });
		await createIssue(as(admin), 'OTHER', { title: 'secret' });
		await expect(getIssue(as(guest), 'OTHER', 1)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('アーカイブ済みプロジェクトには起票できない', async () => {
		await seedProject(db, { key: 'OLD', members: [member], archived: true });
		await expect(createIssue(as(member), 'OLD', { title: 'A' })).rejects.toMatchObject({
			code: 'conflict'
		});
	});
	it('カンバン移動: 同じ位置の課題が並んでいても間に入れられる（列を振り直す）', async () => {
		await Promise.all(['A', 'B', 'C'].map((t) => createIssue(as(member), 'ACME', { title: t })));
		// 同時起票で位置が衝突しうるので、確実に衝突した状態を作る
		await db.update(issueTable).set({ position: 'a0' });
		const byNumber = (await listBoard(as(member), 'ACME')).columns.todo.sort(
			(x, y) => x.number - y.number
		);
		const [i1, i2, i3] = byNumber;
		await moveIssue(as(member), 'ACME', {
			issueId: i3.id,
			status: 'todo',
			beforeId: i1.id,
			afterId: i2.id
		});
		expect((await listBoard(as(member), 'ACME')).columns.todo.map((i) => i.number)).toEqual([
			i1.number,
			i3.number,
			i2.number
		]);
	});

	describe('カンバン移動: 不正な隣接 ID は validation で、何も変わらない', () => {
		const cases: [
			string,
			(ids: { a: string; b: string; c: string; other: string; gone: string }) => {
				issueId: string;
				beforeId: string;
				afterId: string;
			}
		][] = [
			['前後が逆', (x) => ({ issueId: x.c, beforeId: x.b, afterId: x.a })],
			['beforeId が自分自身', (x) => ({ issueId: x.c, beforeId: x.c, afterId: '' })],
			['別プロジェクトの課題', (x) => ({ issueId: x.c, beforeId: x.other, afterId: '' })],
			['削除済みの課題', (x) => ({ issueId: x.c, beforeId: x.gone, afterId: '' })]
		];
		it.each(cases)('%s', async (_name, build) => {
			for (const t of ['A', 'B', 'C']) await createIssue(as(member), 'ACME', { title: t });
			await seedProject(db, { key: 'OTHER' });
			await createIssue(as(admin), 'OTHER', { title: 'o' });
			await createIssue(as(member), 'ACME', { title: 'G' });
			const todo = (await listBoard(as(member), 'ACME')).columns.todo;
			const id = (t: string) => todo.find((i) => i.title === t)!.id;
			const other = (await listBoard(as(admin), 'OTHER')).columns.todo[0].id;
			const ids = { a: id('A'), b: id('B'), c: id('C'), other, gone: id('G') };
			await deleteIssue(as(member), 'ACME', todo.find((i) => i.title === 'G')!.number);
			const before = await listBoard(as(member), 'ACME');
			await expect(
				moveIssue(as(member), 'ACME', { status: 'todo', ...build(ids) })
			).rejects.toMatchObject({ code: 'validation' });
			expect(await listBoard(as(member), 'ACME')).toEqual(before);
		});
	});

	describe('listTimeline', () => {
		it('日付のある課題と、日付がなく未完了の課題に分ける', async () => {
			await createIssue(as(member), 'ACME', {
				title: 'A',
				startDate: '2026-10-06',
				dueDate: '2026-10-08'
			});
			await createIssue(as(member), 'ACME', { title: 'B', dueDate: '2026-10-09' });
			await createIssue(as(member), 'ACME', { title: 'C' });
			await createIssue(as(member), 'ACME', { title: 'D', status: 'done' });
			await createIssue(as(member), 'ACME', { title: 'E', status: 'done', dueDate: '2026-10-01' });
			const t = await listTimeline(as(member), 'ACME');
			expect(t.scheduled.map((i) => i.number)).toEqual([1, 2, 5]);
			expect(t.scheduled[0]).toMatchObject({ startDate: '2026-10-06', dueDate: '2026-10-08' });
			expect(t.unscheduled.map((i) => i.number)).toEqual([3]);
		});

		it('canEdit: ゲストも全課題 true、アーカイブ済みは全員 false', async () => {
			await createIssue(as(guest), 'ACME', { title: 'G', dueDate: '2026-10-10' });
			await createIssue(as(member), 'ACME', { title: 'M', dueDate: '2026-10-10' });
			const byGuest = await listTimeline(as(guest), 'ACME');
			expect(byGuest.scheduled.map((i) => [i.number, i.canEdit])).toEqual([
				[1, true],
				[2, true]
			]);
			const byMember = await listTimeline(as(member), 'ACME');
			expect(byMember.scheduled.every((i) => i.canEdit)).toBe(true);

			await setProjectArchived(as(admin), 'ACME', true);
			const archived = await listTimeline(as(admin), 'ACME');
			expect(archived.scheduled.some((i) => i.canEdit)).toBe(false);
		});

		it('未参加者には存在を隠す', async () => {
			const outsider = await seedUser(db, 'member', 'outsider');
			await expect(listTimeline(as(outsider), 'ACME')).rejects.toMatchObject({
				code: 'not_found'
			});
		});
	});

	describe('一覧の担当者名とカテゴリー名', () => {
		async function insertRaw(
			number: number,
			values: { assigneeIds?: string[]; categoryIds?: string[] }
		) {
			const p = await requireProject(as(admin), 'ACME');
			await db.insert(issueTable).values({
				id: `raw-${number}`,
				projectId: p.id,
				number,
				title: `raw ${number}`,
				reporterId: admin.id,
				position: `a${number}`,
				...values
			});
		}

		it('listIssues keeps assignee order and names of disabled users', async () => {
			await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id, member.id] });
			await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
			await insertRaw(2, { assigneeIds: [member.id, 'gone'] });
			const byNumber = new Map(
				(await listIssues(as(member), 'ACME')).map((i) => [i.number, i.assignees])
			);
			expect(byNumber.get(1)).toEqual([
				{ id: guest.id, name: 'guest' },
				{ id: member.id, name: 'member' }
			]);
			expect(byNumber.get(2)).toEqual([{ id: member.id, name: 'member' }]);
		});

		it('listIssues lists categories in project order and drops deleted ones', async () => {
			await createCategory(as(admin), 'ACME', { name: 'X' });
			await createCategory(as(admin), 'ACME', { name: 'Y' });
			const [x, y] = await listCategories(as(admin), 'ACME');
			await insertRaw(1, { categoryIds: ['gone', y.id, x.id] });
			const [row] = await listIssues(as(member), 'ACME');
			expect(row.categories).toEqual([
				{ id: x.id, name: 'X' },
				{ id: y.id, name: 'Y' }
			]);
			expect(row.categoryIds).toEqual(['gone', y.id, x.id]);
		});

		it('listIssues reads issues in one round trip after the project lookup', async () => {
			await createCategory(as(admin), 'ACME', { name: 'X' });
			const [x] = await listCategories(as(admin), 'ACME');
			await createIssue(as(member), 'ACME', {
				title: 'A',
				assigneeIds: [member.id],
				categoryIds: [x.id]
			});
			// リクエスト内のキャッシュ（memo）があるとき、プロジェクトの行は引き直さない
			const ctx = { ...as(member), memo: new Map() };
			await requireProject(ctx, 'ACME');
			const before = roundTrips(db);
			const [row] = await listIssues(ctx, 'ACME');
			expect(roundTrips(db) - before).toBe(1);
			expect(row.assignees).toEqual([{ id: member.id, name: 'member' }]);
			expect(row.categories).toEqual([{ id: x.id, name: 'X' }]);
		});
	});
});
