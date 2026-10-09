import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	createIssue,
	deleteIssue,
	getIssue,
	listBoard,
	listIssues,
	moveIssue,
	updateIssue
} from './issues';

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
});
