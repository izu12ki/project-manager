import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { eq, sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
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
	BOARD_COLUMN_MAX,
	BOARD_PAGE_SIZE,
	createIssue,
	deleteIssue,
	getIssue,
	listBoard,
	listDeletedIssues,
	listIssueChanges,
	listIssues,
	listTimeline,
	moveIssue,
	SCHEDULED_LIMIT,
	updateIssue,
	type TimelineView
} from './issues';
import { addComment, deleteComment, listComments } from './comments';
import { getIssueDetailRows } from './issue-detail';
import {
	createCategory,
	createIssueType,
	createMilestone,
	listCategories,
	listIssueTypes,
	listMilestones
} from './issue-fields';
import { categoryIdsValue } from './issue-input';
import { listNotifications } from './notifications';
import { listAssignableUsers, requireProject, setProjectArchived } from './projects';

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

	it('ステータスを変えると移動先の列の末尾に入る。完了の列は最近完了にしたものが上', async () => {
		for (const t of ['A', 'B', 'C', 'D']) await createIssue(as(member), 'ACME', { title: t });
		await updateIssue(as(member), 'ACME', 2, { status: 'in_progress' });
		await updateIssue(as(member), 'ACME', 1, { status: 'in_progress' });
		await updateIssue(as(member), 'ACME', 4, { status: 'done' });
		await updateIssue(as(member), 'ACME', 3, { status: 'done' });
		const { columns } = await listBoard(as(member), 'ACME');
		expect(columns.in_progress.map((i) => i.number)).toEqual([2, 1]);
		expect(columns.done.map((i) => i.number)).toEqual([3, 4]);
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

	describe('カンバンの列の上限', () => {
		/**
		 * 課題を直接入れる（createIssue を数百回呼ぶと遅い）。position は列の中で numbers の順（reverse なら逆順）、
		 * updatedAt は番号の大きいものほど新しい
		 */
		async function insertMany(numbers: number[], status: string, reverse = false) {
			const p = await requireProject(as(admin), 'ACME');
			const keys = generateNKeysBetween(null, null, numbers.length);
			if (reverse) keys.reverse();
			const rows = numbers.map((n, i) => ({
				id: `bulk-${n}`,
				projectId: p.id,
				number: n,
				title: `課題 ${n}`,
				status,
				reporterId: admin.id,
				position: keys[i],
				updatedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000)
			}));
			// D1 の 1 文の変数は 100 個まで
			for (let i = 0; i < rows.length; i += 5)
				await db.insert(issueTable).values(rows.slice(i, i + 5));
			await db
				.update(projectTable)
				.set({ nextIssueNumber: Math.max(...numbers) + 1 })
				.where(eq(projectTable.id, p.id));
		}
		const range = (from: number, to: number) =>
			Array.from({ length: to - from + 1 }, (_, i) => from + i);

		it('各列は上から BOARD_PAGE_SIZE 件、完了の列は position の大きい方から出し、総数も返す', async () => {
			await insertMany(range(1, BOARD_PAGE_SIZE + 5), 'todo');
			// 完了の列の position は番号と逆順にして、updatedAt（番号の大きいものほど新しい）ではなく position で選ぶことを確かめる
			const done = range(1001, 1000 + BOARD_PAGE_SIZE + 10);
			await insertMany(done, 'done', true);
			await insertMany([2001, 2002], 'in_progress');
			const { columns, totals } = await listBoard(as(member), 'ACME');
			expect(columns.todo.map((i) => i.number)).toEqual(range(1, BOARD_PAGE_SIZE));
			// position の大きい順 = 番号の小さい順
			expect(columns.done.map((i) => i.number)).toEqual(done.slice(0, BOARD_PAGE_SIZE));
			expect(columns.in_progress.map((i) => i.number)).toEqual([2001, 2002]);
			expect(totals).toEqual({
				todo: BOARD_PAGE_SIZE + 5,
				in_progress: 2,
				in_review: 0,
				done: BOARD_PAGE_SIZE + 10
			});
		});

		it('列ごとに読み込む数を変えられる（絞り込みと合わせても）。上限は BOARD_COLUMN_MAX', async () => {
			await insertMany(range(1, BOARD_PAGE_SIZE * 2 + 5), 'todo');
			const done = range(1001, 1000 + BOARD_PAGE_SIZE + 10);
			await insertMany(done, 'done');
			const { columns, totals } = await listBoard(
				as(member),
				'ACME',
				{},
				{ todo: BOARD_PAGE_SIZE * 2, done: BOARD_PAGE_SIZE * 2 }
			);
			expect(columns.todo.map((i) => i.number)).toEqual(range(1, BOARD_PAGE_SIZE * 2));
			expect(columns.done.map((i) => i.number)).toEqual([...done].reverse());
			expect(totals.todo).toBe(BOARD_PAGE_SIZE * 2 + 5);

			await createMilestone(as(admin), 'ACME', { name: 'v1' });
			const [v1] = await listMilestones(as(admin), 'ACME');
			for (const n of [3, 40, 52]) await updateIssue(as(admin), 'ACME', n, { milestoneId: v1.id });
			const filtered = await listBoard(as(member), 'ACME', { milestoneId: v1.id }, { todo: 2 });
			expect(filtered.columns.todo.map((i) => i.number)).toEqual([3, 40]);
			expect(filtered.totals.todo).toBe(3);

			const capped = await listBoard(as(member), 'ACME', {}, { todo: BOARD_COLUMN_MAX + 100 });
			expect(capped.columns.todo).toHaveLength(BOARD_PAGE_SIZE * 2 + 5);
		});

		it('総数は絞り込んだ後の数。削除した課題は数えない', async () => {
			await createIssue(as(admin), 'ACME', { title: 'A' });
			await createIssue(as(admin), 'ACME', { title: 'B' });
			await deleteIssue(as(admin), 'ACME', 2);
			await createMilestone(as(admin), 'ACME', { name: 'v1' });
			const [v1] = await listMilestones(as(admin), 'ACME');
			await createIssue(as(admin), 'ACME', { title: 'C', milestoneId: v1.id });
			expect((await listBoard(as(member), 'ACME')).totals.todo).toBe(2);
			expect((await listBoard(as(member), 'ACME', { milestoneId: v1.id })).totals.todo).toBe(1);
		});

		/** 列の課題を position の順に（見えていないものも含めて） */
		async function columnOrder(status: string) {
			const all = await listIssues(as(member), 'ACME', { status });
			return [...all]
				.sort((a, b) =>
					a.position < b.position ? -1 : a.position > b.position ? 1 : a.number - b.number
				)
				.map((i) => i.number);
		}

		it('前の課題だけ指定した移動は、読み込んでいない課題があっても、その課題の直後に入る', async () => {
			await insertMany(range(1, BOARD_PAGE_SIZE + 5), 'todo');
			await createIssue(as(member), 'ACME', { title: '新しい課題', status: 'in_progress' });
			const { columns } = await listBoard(as(member), 'ACME');
			const moving = columns.in_progress[0];
			// 見えている最後の課題（25）の後へ落とすと、読み込んでいない 26〜30 より前に入る
			await moveIssue(as(member), 'ACME', {
				issueId: moving.id,
				status: 'todo',
				beforeId: columns.todo.at(-1)!.id,
				afterId: ''
			});
			const order = await columnOrder('todo');
			expect(order.slice(BOARD_PAGE_SIZE - 1, BOARD_PAGE_SIZE + 2)).toEqual([
				BOARD_PAGE_SIZE,
				moving.number,
				BOARD_PAGE_SIZE + 1
			]);
			expect(new Set(order).size).toBe(BOARD_PAGE_SIZE + 6);
		});

		it('後ろの課題だけ指定した移動は、その課題の直前に入る（完了の列の一番下へ落とした場合など）', async () => {
			// 完了の列は position の大きい順に出すので、画面で一番下の課題の「後ろ」（position が大きい方）だけが分かる
			await insertMany(range(1001, 1000 + BOARD_PAGE_SIZE + 5), 'done');
			await createIssue(as(member), 'ACME', { title: '新しい課題' });
			const { columns } = await listBoard(as(member), 'ACME');
			const bottom = columns.done.at(-1)!;
			const moving = columns.todo.find((i) => i.title === '新しい課題')!;
			await moveIssue(as(member), 'ACME', {
				issueId: moving.id,
				status: 'done',
				beforeId: '',
				afterId: bottom.id
			});
			const after = await listBoard(as(member), 'ACME', {}, { done: BOARD_PAGE_SIZE + 1 });
			const shown = after.columns.done.map((i) => i.number);
			expect(shown.slice(-2)).toEqual([bottom.number, moving.number]);
			// 読み込んでいなかった課題は、移した課題より下のまま
			const order = await columnOrder('done');
			expect(order.slice(0, 6)).toEqual([...range(1001, 1005), moving.number]);
		});

		it('前後どちらも指定しない移動（空の列へ）は、列の末尾に入る', async () => {
			await insertMany(range(1, 3), 'in_review');
			await createIssue(as(member), 'ACME', { title: '新しい課題' });
			const moving = (await listBoard(as(member), 'ACME')).columns.todo[0];
			await moveIssue(as(member), 'ACME', {
				issueId: moving.id,
				status: 'in_review',
				beforeId: '',
				afterId: ''
			});
			expect(await columnOrder('in_review')).toEqual([1, 2, 3, moving.number]);
		});
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

	it('キーワードは本文とコメントの部分一致でも探せる。削除したコメントや他の課題のコメントでは当たらない', async () => {
		await createIssue(as(member), 'ACME', {
			title: 'A',
			description: '手順: Safari で Login する'
		});
		await createIssue(as(member), 'ACME', { title: 'B' });
		await createIssue(as(member), 'ACME', { title: 'C' });
		await addComment(as(member), 'ACME', 2, { body: '再現ログを添付しました' });
		await addComment(as(member), 'ACME', 2, { body: '再現ログをもう一度取りました' });
		await addComment(as(member), 'ACME', 3, { body: '一時的なメモ' });
		const [memo] = await listComments(as(member), 'ACME', 3);
		await deleteComment(as(member), 'ACME', 3, memo.id);
		const numbers = async (q: string) =>
			(await listIssues(as(member), 'ACME', { q })).map((i) => i.number);

		expect(await numbers('safari で login')).toEqual([1]);
		// 同じ課題の複数のコメントに当たっても 1 行
		expect(await numbers('再現ログ')).toEqual([2]);
		expect(await numbers('一時的なメモ')).toEqual([]);
		// ほかの条件とも組み合わさる
		expect(await listIssues(as(member), 'ACME', { q: 'Safari', status: 'done' })).toEqual([]);
	});

	it('ステータスの open は完了以外', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B', status: 'in_progress' });
		await createIssue(as(member), 'ACME', { title: 'C', status: 'done' });
		const numbers = async (status: string) =>
			(await listIssues(as(member), 'ACME', { status })).map((i) => i.number).sort();

		expect(await numbers('open')).toEqual([1, 2]);
		expect(await numbers('done')).toEqual([3]);
	});

	it('Backlog から取り込んだ課題は、元のキーでも探せる（英字の大小は区別しない）', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await db.update(issueTable).set({ backlogKey: 'OLD-7' }).where(eq(issueTable.number, 2));
		const numbers = async (q: string) =>
			(await listIssues(as(member), 'ACME', { q })).map((i) => i.number);

		expect(await numbers('OLD-7')).toEqual([2]);
		expect(await numbers(' old-7 ')).toEqual([2]);
		expect(await numbers('OLD-1')).toEqual([]);
		// このプロジェクトのキーは、これまでどおり番号で探す
		expect(await numbers('ACME-1')).toEqual([1]);
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
		it('日付のある課題を返し、日付がなく未完了の課題はあるかどうかだけ返す', async () => {
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
			expect(t.hasUnscheduled).toBe(true);
			expect(t.scheduledMore).toBe(false);
			// 日付のない課題が完了だけなら、ない
			await updateIssue(as(member), 'ACME', 3, { status: 'done' });
			expect((await listTimeline(as(member), 'ACME')).hasUnscheduled).toBe(false);
		});

		it('完了した課題は表示の開始日より前に終わったものを除く。未完了の課題は残す', async () => {
			const from = '2026-10-05';
			await createIssue(as(member), 'ACME', {
				title: '前に完了',
				status: 'done',
				dueDate: '2026-10-04'
			});
			await createIssue(as(member), 'ACME', {
				title: '開始日だけで前に完了',
				status: 'done',
				startDate: '2026-10-01'
			});
			await createIssue(as(member), 'ACME', {
				title: '開始日の当日に完了',
				status: 'done',
				dueDate: '2026-10-05'
			});
			await createIssue(as(member), 'ACME', {
				title: '開始日をまたいで完了',
				status: 'done',
				startDate: '2026-09-20',
				dueDate: '2026-10-10'
			});
			await createIssue(as(member), 'ACME', { title: '期限切れで未完了', dueDate: '2026-09-01' });
			expect(
				(await listTimeline(as(member), 'ACME', { from })).scheduled.map((i) => i.number)
			).toEqual([3, 4, 5]);
			// 開始日を指定しなければすべて
			expect((await listTimeline(as(member), 'ACME')).scheduled.map((i) => i.number)).toEqual([
				1, 2, 3, 4, 5
			]);
		});

		it('絞り込みはサーバーで行い、日付のない課題があるかどうかにも効く', async () => {
			await createCategory(as(admin), 'ACME', { name: 'X' });
			const [x] = await listCategories(as(admin), 'ACME');
			await createIssue(as(member), 'ACME', {
				title: 'A',
				dueDate: '2026-10-10',
				assigneeIds: [guest.id],
				categoryIds: [x.id]
			});
			await createIssue(as(member), 'ACME', { title: 'B', dueDate: '2026-10-10' });
			await createIssue(as(member), 'ACME', { title: 'C', assigneeIds: [guest.id] });
			await createIssue(as(member), 'ACME', { title: 'D' });
			await createIssue(as(member), 'ACME', {
				title: 'E',
				status: 'in_progress',
				dueDate: '2026-10-11'
			});
			const numbers = async (filters: TimelineView['filters']) => {
				const t = await listTimeline(as(member), 'ACME', { filters });
				return [t.scheduled.map((i) => i.number), t.hasUnscheduled];
			};
			expect(await numbers({})).toEqual([[1, 2, 5], true]);
			expect(await numbers({ assigneeId: guest.id })).toEqual([[1], true]);
			expect(await numbers({ assigneeId: 'none' })).toEqual([[2, 5], true]);
			expect(await numbers({ categoryId: x.id })).toEqual([[1], false]);
			expect(await numbers({ status: 'in_progress' })).toEqual([[5], false]);
			expect(await numbers({ status: 'open' })).toEqual([[1, 2, 5], true]);
			expect(await numbers({ status: 'todo' })).toEqual([[1, 2], true]);
			expect(await numbers({ status: 'done' })).toEqual([[], false]);
		});

		it('種別で絞る。完了で絞ると、開始日より前に終わったものは除く', async () => {
			await createIssueType(as(admin), 'ACME', { name: '調査', color: 'amber' });
			const bug = (await listIssueTypes(as(admin), 'ACME')).find((t) => t.name === '調査')!;
			await createIssue(as(member), 'ACME', { title: 'A', typeId: bug.id, dueDate: '2026-10-10' });
			await createIssue(as(member), 'ACME', { title: 'B', dueDate: '2026-10-10' });
			await createIssue(as(member), 'ACME', { title: 'C', typeId: bug.id });
			await createIssue(as(member), 'ACME', { title: 'D', status: 'done', dueDate: '2026-10-01' });
			await createIssue(as(member), 'ACME', { title: 'E', status: 'done', dueDate: '2026-10-09' });
			const t = await listTimeline(as(member), 'ACME', { filters: { typeId: bug.id } });
			expect([t.scheduled.map((i) => i.number), t.hasUnscheduled]).toEqual([[1], true]);
			const done = await listTimeline(as(member), 'ACME', {
				from: '2026-10-05',
				filters: { status: 'done' }
			});
			expect(done.scheduled.map((i) => i.number)).toEqual([5]);
		});

		it(`日付のある課題は表示の開始日に近い順に ${SCHEDULED_LIMIT} 件まで。超えるかどうかを返す`, async () => {
			const p = await requireProject(as(admin), 'ACME');
			const from = '2026-10-05';
			// #1〜#(上限+2) は from から番号の日数だけ前に期限があり、#(上限+3) は from をまたぐ
			const n = SCHEDULED_LIMIT + 3;
			const rows = Array.from({ length: n }, (_, i) => {
				const number = i + 1;
				const due = new Date(Date.UTC(2026, 9, 5) - number * 86_400_000).toISOString().slice(0, 10);
				return {
					id: `s-${number}`,
					projectId: p.id,
					number,
					title: `日付あり ${number}`,
					reporterId: admin.id,
					position: `a${number}`,
					...(number === n ? { startDate: '2026-09-01', dueDate: '2026-10-20' } : { dueDate: due })
				};
			});
			// D1 の 1 文の変数は 100 個まで
			for (let i = 0; i < rows.length; i += 5)
				await db.insert(issueTable).values(rows.slice(i, i + 5));
			const t = await listTimeline(as(member), 'ACME', { from });
			expect(t.scheduledMore).toBe(true);
			// from をまたぐ #n と、期限の近い #1〜#(上限-1)。遠い 3 件は出さない。並びは番号順
			expect(t.scheduled.map((i) => i.number)).toEqual([
				...Array.from({ length: SCHEDULED_LIMIT - 1 }, (_, i) => i + 1),
				n
			]);
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

	describe('カンバンとガントは 1 往復', () => {
		beforeEach(async () => {
			await createCategory(as(admin), 'ACME', { name: 'X' });
			await createMilestone(as(admin), 'ACME', { name: 'v1', releaseDate: '2026-12-01' });
			await seedProject(db, { key: 'OTHER' });
			await createMilestone(as(admin), 'OTHER', { name: '別プロジェクト' });
			await createIssue(as(member), 'ACME', { title: 'A', dueDate: '2026-12-01' });
			await createIssue(as(member), 'ACME', { title: 'B', status: 'done' });
		});

		it('listBoard returns the milestones too, in one round trip', async () => {
			const [ms] = await listMilestones(as(member), 'ACME');
			const before = roundTrips(db);
			const board = await listBoard(as(member), 'ACME', { milestoneId: ms.id });
			expect(roundTrips(db) - before).toBe(1);
			expect(board.milestones).toEqual(await listMilestones(as(member), 'ACME'));
			expect(board.columns.todo).toEqual([]);
		});

		it('listTimeline returns milestones, categories and assignable users too, in one round trip', async () => {
			const before = roundTrips(db);
			const t = await listTimeline(as(guest), 'ACME');
			expect(roundTrips(db) - before).toBe(1);
			const p = await requireProject(as(guest), 'ACME');
			expect(t.milestones).toEqual(await listMilestones(as(guest), 'ACME'));
			expect(t.categories).toEqual(await listCategories(as(guest), 'ACME'));
			expect(t.assignees).toEqual(await listAssignableUsers(db, p.id));
			expect(t.scheduled.map((i) => i.title)).toEqual(['A']);
		});

		it('listBoard hides projects the actor has not joined', async () => {
			const outsider = await seedUser(db, 'member', 'outsider');
			await expect(listBoard(as(outsider), 'ACME')).rejects.toMatchObject({
				code: 'not_found'
			});
		});
	});

	// D1 は 1 往復ごとに CPU 時間がかかる。分類項目・担当可能な人・親課題・アクセス権などはまとめて 1 往復で読み、
	// プロジェクトのすべての課題は読まない
	describe('起票・保存の往復', () => {
		it('createIssue reads in one round trip and writes in one', async () => {
			await createIssue(as(member), 'ACME', { title: '親' });
			const before = roundTrips(db);
			expect(await createIssue(as(member), 'ACME', { title: '子', parentNumber: 1 })).toEqual({
				number: 2
			});
			expect(roundTrips(db) - before).toBe(2);
			expect((await getIssue(as(member), 'ACME', 2)).issue.parent).toEqual({
				number: 1,
				title: '親'
			});
		});

		it('createIssue that assigns someone notifies them without reading the project again', async () => {
			const before = roundTrips(db);
			await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
			// 読み取り・書き込み・通知の書き込み・メールの宛先
			expect(roundTrips(db) - before).toBe(4);
			expect((await listNotifications(as(guest))).map((n) => n.type)).toEqual(['assigned']);
			await Promise.all(base.pending);
			expect(base.sent.map((m) => m.to)).toEqual([guest.email]);
		});

		it('updateIssue reads in one round trip, writes in one and returns the changed fields', async () => {
			await createIssue(as(member), 'ACME', { title: 'A' });
			const before = roundTrips(db);
			expect(await updateIssue(as(member), 'ACME', 1, { title: 'B', priority: 'high' })).toEqual([
				'title',
				'priority'
			]);
			expect(roundTrips(db) - before).toBe(2);
			expect(await updateIssue(as(member), 'ACME', 1, { title: 'B' })).toEqual([]);
		});

		it('updateIssue notifies the reporter and commenters with what it read before writing', async () => {
			await createIssue(as(guest), 'ACME', { title: 'A' });
			await addComment(as(guest2), 'ACME', 1, { body: 'コメント' });
			const before = roundTrips(db);
			await updateIssue(as(member), 'ACME', 1, { status: 'in_progress' });
			// 読み取り・書き込み・通知の書き込み（ステータスの変更はメールで送らない）
			expect(roundTrips(db) - before).toBe(3);
			for (const a of [guest, guest2]) {
				expect((await listNotifications(as(a))).map((n) => n.type)).toContain('status_changed');
			}
			const { columns } = await listBoard(as(member), 'ACME');
			expect(columns.in_progress.map((i) => i.number)).toEqual([1]);
		});
	});

	it('listIssueChanges reads in one round trip and hides projects the actor has not joined', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await updateIssue(as(member), 'ACME', 1, { title: 'B' });
		const before = roundTrips(db);
		const changes = await listIssueChanges(as(guest), 'ACME', 1);
		expect(roundTrips(db) - before).toBe(1);
		expect(changes.map((c) => c.changes)).toEqual([[{ field: 'title', from: 'A', to: 'B' }]]);
		const outsider = await seedUser(db, 'member', 'outsider');
		await expect(listIssueChanges(as(outsider), 'ACME', 1)).rejects.toMatchObject({
			code: 'not_found'
		});
	});
});
