import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { eq } from 'drizzle-orm';
import { issue as issueTable, user as userTable } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	createIssue,
	deleteIssue,
	getIssue,
	listBoard,
	listIssues,
	listTimeline,
	moveIssue,
	updateIssue
} from './issues';
import { setProjectArchived } from './projects';

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
		const board = await listBoard(as(member), 'ACME');
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
		const board = await listBoard(as(member), 'ACME');
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
		await expect(
			createIssue(as(guest), 'ACME', { title: 'C', status: 'done' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('同時に起票しても番号が重複しない', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) => createIssue(as(member), 'ACME', { title: `T${i}` }))
		);
		expect(results.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('ゲストは起票時に担当者を指定できない', async () => {
		await expect(
			createIssue(as(guest), 'ACME', { title: 'A', assigneeId: member.id })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('参加者でない人は担当者にできない', async () => {
		const outsider = await seedUser(db, 'member', 'outsider');
		await expect(
			createIssue(as(member), 'ACME', { title: 'A', assigneeId: outsider.id })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('ゲストは自分が起票した課題だけ内容を編集できる', async () => {
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
		await expect(updateIssue(as(guest), 'ACME', 2, { title: 'x' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(updateIssue(as(guest2), 'ACME', 1, { title: 'x' })).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it('値が変わっていない項目は権限チェックしない（フォームが全項目を送るため）', async () => {
		await createIssue(as(member), 'ACME', { title: 'theirs', assigneeId: guest.id });
		await updateIssue(as(guest), 'ACME', 1, {
			title: 'theirs',
			status: 'in_progress',
			assigneeId: guest.id
		});
		expect((await getIssue(as(guest), 'ACME', 1)).issue.status).toBe('in_progress');
	});

	it('担当者が後から無効化されても、同じ担当者のままステータスを変更できる', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id });
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		await updateIssue(as(member), 'ACME', 1, { status: 'done', assigneeId: guest.id });
		const { issue } = await getIssue(as(member), 'ACME', 1);
		expect(issue).toMatchObject({ status: 'done', assigneeId: guest.id });
		await expect(
			updateIssue(as(member), 'ACME', 1, { assigneeId: guest2.id })
		).resolves.not.toThrow();
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		await expect(
			updateIssue(as(member), 'ACME', 1, { assigneeId: guest.id })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('ゲストは自分が担当の課題だけステータスを変えられ、担当者は変えられない', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(guest), 'ACME', 1, { status: 'done' });
		await expect(updateIssue(as(guest), 'ACME', 2, { status: 'done' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(updateIssue(as(guest), 'ACME', 1, { assigneeId: '' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await updateIssue(as(member), 'ACME', 2, { assigneeId: guest2.id });
		expect((await getIssue(as(member), 'ACME', 2)).issue.assigneeName).toBe('guest2');
	});

	it('ステータスを変えると移動先の列の末尾に入る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(member), 'ACME', 2, { status: 'done' });
		await updateIssue(as(member), 'ACME', 1, { status: 'done' });
		expect((await listBoard(as(member), 'ACME')).done.map((i) => i.number)).toEqual([2, 1]);
	});

	it('カンバン移動: 前後の課題の間に入る', async () => {
		for (const t of ['A', 'B', 'C']) await createIssue(as(member), 'ACME', { title: t });
		const ids = (await listBoard(as(member), 'ACME')).todo.map((i) => i.id);
		// C を A と B の間へ
		await moveIssue(as(member), 'ACME', {
			issueId: ids[2],
			status: 'todo',
			beforeId: ids[0],
			afterId: ids[1]
		});
		expect((await listBoard(as(member), 'ACME')).todo.map((i) => i.title)).toEqual(['A', 'C', 'B']);
		// B を in_review の空の列へ
		await moveIssue(as(member), 'ACME', {
			issueId: ids[1],
			status: 'in_review',
			beforeId: '',
			afterId: ''
		});
		const board = await listBoard(as(member), 'ACME');
		expect(board.in_review.map((i) => i.title)).toEqual(['B']);
		expect(board.todo.map((i) => i.title)).toEqual(['A', 'C']);
	});

	it('カンバン移動: 隣接 ID が別の列のもの（古い画面）なら validation', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		const [a, b] = (await listBoard(as(member), 'ACME')).todo;
		await updateIssue(as(member), 'ACME', b.number, { status: 'done' });
		await expect(
			moveIssue(as(member), 'ACME', { issueId: a.id, status: 'todo', beforeId: b.id, afterId: '' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('カンバン移動: ゲストは担当外の課題を動かせない', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const [a] = (await listBoard(as(member), 'ACME')).todo;
		await expect(
			moveIssue(as(guest), 'ACME', { issueId: a.id, status: 'done', beforeId: '', afterId: '' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('一覧の絞り込み', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id, priority: 'high' });
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

	it('削除はメンバー以上。ゲストは不可', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await expect(deleteIssue(as(guest), 'ACME', 1)).rejects.toMatchObject({ code: 'forbidden' });
		await deleteIssue(as(member), 'ACME', 1);
		await expect(getIssue(as(member), 'ACME', 1)).rejects.toMatchObject({ code: 'not_found' });
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
		const byNumber = (await listBoard(as(member), 'ACME')).todo.sort((x, y) => x.number - y.number);
		const [i1, i2, i3] = byNumber;
		await moveIssue(as(member), 'ACME', {
			issueId: i3.id,
			status: 'todo',
			beforeId: i1.id,
			afterId: i2.id
		});
		expect((await listBoard(as(member), 'ACME')).todo.map((i) => i.number)).toEqual([
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
			const todo = (await listBoard(as(member), 'ACME')).todo;
			const id = (t: string) => todo.find((i) => i.title === t)!.id;
			const other = (await listBoard(as(admin), 'OTHER')).todo[0].id;
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

		it('canEdit: ゲストは自分の起票だけ、アーカイブ済みは全員 false', async () => {
			await createIssue(as(guest), 'ACME', { title: 'G', dueDate: '2026-10-10' });
			await createIssue(as(member), 'ACME', { title: 'M', dueDate: '2026-10-10' });
			const byGuest = await listTimeline(as(guest), 'ACME');
			expect(byGuest.scheduled.map((i) => [i.number, i.canEdit])).toEqual([
				[1, true],
				[2, false]
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
});
