import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Actor } from '../authz';
import type { DB } from '../db';
import {
	issue as issueTable,
	notification,
	project as projectTable,
	user as userTable,
	userIntegration
} from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { bulkCreateIssues, bulkUpdateIssues } from './issue-bulk';
import { createIssue, deleteIssue, getIssue, listIssueChanges, listIssues } from './issues';

describe('issue-bulk', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const create = (items: unknown[], dryRun = false) =>
		bulkCreateIssues(as(admin), 'ACME', { items }, { dryRun });
	const update = (items: unknown[], dryRun = false) =>
		bulkUpdateIssues(as(admin), 'ACME', { items }, { dryRun });
	const nextNumber = async () =>
		(
			await db
				.select({ n: projectTable.nextIssueNumber })
				.from(projectTable)
				.where(eq(projectTable.key, 'ACME'))
		)[0].n;
	const issueCount = async () => (await db.select().from(issueTable)).length;

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		await seedProject(db, { key: 'ACME', members: [member] });
	});

	it('3 件を一括起票すると、番号が連番で返り、nextIssueNumber が 3 進む', async () => {
		await createIssue(as(admin), 'ACME', { title: '既存' });
		const before = await nextNumber();
		const res = await create([
			{ title: 'A', status: 'in_progress', assigneeId: member.id },
			{ title: 'B', dueDate: '2026-12-31' },
			{ title: 'C' }
		]);
		expect(res).toEqual({ numbers: [2, 3, 4] });
		expect(await nextNumber()).toBe(before + 3);
		const rows = await listIssues(as(admin), 'ACME');
		expect(rows.map((r) => [r.number, r.title, r.status]).sort()).toEqual([
			[1, '既存', 'todo'],
			[2, 'A', 'in_progress'],
			[3, 'B', 'todo'],
			[4, 'C', 'todo']
		]);
		const { issue } = await getIssue(as(admin), 'ACME', 2);
		expect(issue).toMatchObject({ assigneeId: member.id, reporterId: admin.id });
		// 同じ列の position は既存の末尾から起票順に並ぶ
		const todo = rows.filter((r) => r.status === 'todo').sort((a, b) => a.number - b.number);
		const positions = todo.map((r) => r.position);
		expect([...positions].sort()).toEqual(positions);
		expect(new Set(positions).size).toBe(positions.length);
	});

	it('2 件目のタイトルが空なら 400、fields に items.1.title があり、課題は 1 件も増えず nextIssueNumber も変わらない', async () => {
		const before = await nextNumber();
		const err = await create([{ title: 'A' }, { title: '' }, { title: 'C' }]).catch((e) => e);
		expect(err).toMatchObject({ code: 'validation' });
		expect(err.fields['items.1.title']).toEqual(['タイトルを入力してください']);
		expect(Object.keys(err.fields)).toEqual(['items.1.title']);
		expect(await issueCount()).toBe(0);
		expect(await nextNumber()).toBe(before);
	});

	it('全要素を検証してからまとめて返す', async () => {
		const err = await create([
			{ title: '' },
			{ title: 'B', startDate: '2026-10-11', dueDate: '2026-10-10' },
			{ title: 'C', typeId: 'bogus', status: 'bogus' }
		]).catch((e) => e);
		expect(err).toMatchObject({ code: 'validation' });
		expect(Object.keys(err.fields).sort()).toEqual([
			'items.0.title',
			'items.1.startDate',
			'items.2.status'
		]);
	});

	it('担当可能でない assigneeId は items.N.assigneeId のエラー', async () => {
		const outsider = await seedUser(db, 'member', 'outsider');
		const err = await create([{ title: 'A' }, { title: 'B', assigneeId: outsider.id }]).catch(
			(e) => e
		);
		expect(err).toMatchObject({ code: 'validation' });
		expect(err.fields).toEqual({ 'items.1.assigneeId': ['このユーザーは担当者にできません'] });
	});

	it('101 件は validation（1 回に 100 件までです）', async () => {
		const items = Array.from({ length: 101 }, (_, i) => ({ title: `T${i}` }));
		await expect(create(items)).rejects.toMatchObject({
			code: 'validation',
			message: '1 回に 100 件までです'
		});
		await expect(create([])).rejects.toMatchObject({ code: 'validation' });
		await expect(update(items.map((it, i) => ({ number: i + 1, ...it })))).rejects.toMatchObject({
			code: 'validation',
			message: '1 回に 100 件までです'
		});
	});

	it('100 件は一度に起票できる', async () => {
		const items = Array.from({ length: 100 }, (_, i) => ({ title: `T${i}` }));
		const { numbers } = await create(items);
		expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
		expect(await nextNumber()).toBe(101);
	});

	it('dryRun では何も書かず、エラーは同じ形で返る', async () => {
		expect(await create([{ title: 'A' }, { title: 'B' }], true)).toEqual({ numbers: [] });
		expect(await issueCount()).toBe(0);
		expect(await nextNumber()).toBe(1);
		const err = await create([{ title: 'A' }, { title: '' }], true).catch((e) => e);
		expect(err).toMatchObject({ code: 'validation' });
		expect(Object.keys(err.fields)).toEqual(['items.1.title']);

		await createIssue(as(admin), 'ACME', { title: 'X' });
		expect(await update([{ number: 1, title: 'Y' }], true)).toEqual({ numbers: [] });
		expect((await getIssue(as(admin), 'ACME', 1)).issue.title).toBe('X');
		const err2 = await update([{ number: 1, title: '' }], true).catch((e) => e);
		expect(Object.keys(err2.fields)).toEqual(['items.0.title']);
	});

	it('一括起票の前後に createIssue を挟んでも番号が重複しない', async () => {
		const results = await Promise.all([
			createIssue(as(admin), 'ACME', { title: 'S1' }).then((r) => [r.number]),
			create([{ title: 'A' }, { title: 'B' }]).then((r) => r.numbers),
			createIssue(as(admin), 'ACME', { title: 'S2' }).then((r) => [r.number]),
			create([{ title: 'C' }, { title: 'D' }]).then((r) => r.numbers)
		]);
		expect(results.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(await nextNumber()).toBe(7);
		expect((await createIssue(as(admin), 'ACME', { title: 'S3' })).number).toBe(7);
	});

	it('一括更新で日付をずらすと、各課題に変更履歴が 1 件ずつ残り、actor がキーの持ち主', async () => {
		await create([
			{ title: 'A', startDate: '2026-10-01', dueDate: '2026-10-05' },
			{ title: 'B', startDate: '2026-10-06', dueDate: '2026-10-10' }
		]);
		const res = await update([
			{ number: 1, startDate: '2026-10-08', dueDate: '2026-10-12' },
			{ number: 2, startDate: '2026-10-13', dueDate: '2026-10-17' }
		]);
		expect(res).toEqual({ numbers: [1, 2] });
		for (const [n, from, to] of [
			[1, ['2026-10-01', '2026-10-05'], ['2026-10-08', '2026-10-12']],
			[2, ['2026-10-06', '2026-10-10'], ['2026-10-13', '2026-10-17']]
		] as const) {
			const changes = await listIssueChanges(as(admin), 'ACME', n);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ actorId: admin.id });
			expect(changes[0].changes).toEqual([
				{ field: 'startDate', from: from[0], to: to[0] },
				{ field: 'dueDate', from: from[1], to: to[1] }
			]);
		}
	});

	it('一括更新: ステータスと担当者の変更は表示名で履歴に残り、列の末尾に入る。変化のない要素は履歴を残さない', async () => {
		await create([{ title: 'A', assigneeId: member.id }, { title: 'B' }, { title: 'C' }]);
		await update([
			{ number: 1, status: 'done', assigneeId: '' },
			{ number: 2, status: 'done' },
			{ number: 3, title: 'C' }
		]);
		expect((await listIssueChanges(as(admin), 'ACME', 1))[0].changes).toEqual([
			{ field: 'status', from: '未着手', to: '完了' },
			{ field: 'assignee', from: 'member', to: null }
		]);
		expect(await listIssueChanges(as(admin), 'ACME', 3)).toEqual([]);
		const done = (await listIssues(as(admin), 'ACME', { status: 'done' })).sort(
			(a, b) => a.number - b.number
		);
		expect(done.map((r) => r.number)).toEqual([1, 2]);
		expect(done[0].position < done[1].position).toBe(true);
	});

	it('一括更新: 無効化された元の担当者も履歴には名前で残る', async () => {
		await create([{ title: 'A', assigneeId: member.id }]);
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, member.id));
		await update([{ number: 1, assigneeId: '' }]);
		expect((await listIssueChanges(as(admin), 'ACME', 1))[0].changes).toEqual([
			{ field: 'assignee', from: 'member', to: null }
		]);
	});

	it('一括更新: 開始日と期限日の前後は現在値と合わせて要素ごとに確かめる', async () => {
		await create([{ title: 'A', dueDate: '2026-10-05' }]);
		const err = await update([{ number: 1, startDate: '2026-10-06' }]).catch((e) => e);
		expect(Object.keys(err.fields)).toEqual(['items.0.startDate']);
	});

	it('一括更新で同じ number が 2 回あると validation（items.N.number）', async () => {
		await create([{ title: 'A' }, { title: 'B' }]);
		const err = await update([
			{ number: 1, title: 'X' },
			{ number: 2, title: 'Y' },
			{ number: 1, title: 'Z' }
		]).catch((e) => e);
		expect(err).toMatchObject({ code: 'validation' });
		expect(Object.keys(err.fields)).toEqual(['items.2.number']);
		expect((await getIssue(as(admin), 'ACME', 1)).issue.title).toBe('A');
	});

	it('存在しない・削除済みの number は items.N.number のエラー', async () => {
		await create([{ title: 'A' }, { title: 'B' }]);
		await deleteIssue(as(admin), 'ACME', 2);
		const err = await update([
			{ number: 1, title: 'X' },
			{ number: 2, title: 'Y' },
			{ number: 99, title: 'Z' },
			{ title: 'number なし' }
		]).catch((e) => e);
		expect(err).toMatchObject({ code: 'validation' });
		expect(Object.keys(err.fields).sort()).toEqual([
			'items.1.number',
			'items.2.number',
			'items.3.number'
		]);
		expect((await getIssue(as(admin), 'ACME', 1)).issue.title).toBe('A');
	});

	it('アーカイブ済みプロジェクトは conflict', async () => {
		await seedProject(db, { key: 'OLD', archived: true });
		await expect(
			bulkCreateIssues(as(admin), 'OLD', { items: [{ title: 'A' }] }, { dryRun: false })
		).rejects.toMatchObject({ code: 'conflict' });
		await expect(
			bulkUpdateIssues(as(admin), 'OLD', { items: [{ number: 1, title: 'A' }] }, { dryRun: true })
		).rejects.toMatchObject({ code: 'conflict' });
	});

	it('見えないプロジェクトは not_found', async () => {
		await seedProject(db, { key: 'HIDDEN' });
		await expect(
			bulkCreateIssues(as(member), 'HIDDEN', { items: [{ title: 'A' }] }, { dryRun: false })
		).rejects.toMatchObject({ code: 'not_found' });
	});
	describe('まとめ通知', () => {
		const notes = () =>
			db
				.select({
					userId: notification.userId,
					type: notification.type,
					count: notification.count,
					issueId: notification.issueId
				})
				.from(notification);

		it('30 件を同じ担当者に一括起票すると、その人の通知は bulk_assigned 1 件で count = 30。自分自身には届かない', async () => {
			await create(
				Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, assigneeId: member.id }))
			);
			expect(await notes()).toEqual([
				{ userId: member.id, type: 'bulk_assigned', count: 30, issueId: null }
			]);
		});

		it('一括更新でステータスを変えると、報告者に bulk_updated が 1 件', async () => {
			await createIssue(as(member), 'ACME', { title: 'A' });
			await createIssue(as(member), 'ACME', { title: 'B' });
			await createIssue(as(member), 'ACME', { title: 'C' });
			await update([
				{ number: 1, status: 'done' },
				{ number: 2, status: 'in_progress' },
				{ number: 3, title: 'C2' }
			]);
			// 3 件目はタイトルだけの変更なので通知対象にならない
			expect(await notes()).toEqual([
				{ userId: member.id, type: 'bulk_updated', count: 2, issueId: null }
			]);
		});

		it('割り当てとステータス変更が混ざると bulk_assigned で、count は割り当てた件数', async () => {
			await createIssue(as(member), 'ACME', { title: 'A' });
			await createIssue(as(member), 'ACME', { title: 'B' });
			await update([
				{ number: 1, status: 'done' },
				{ number: 2, assigneeId: member.id }
			]);
			expect(await notes()).toEqual([
				{ userId: member.id, type: 'bulk_assigned', count: 1, issueId: null }
			]);
		});

		it('dryRun では通知しない', async () => {
			await create([{ title: 'A', assigneeId: member.id }], true);
			expect(await notes()).toEqual([]);
		});

		it('Slack 連携済みの受信者には fetch が 1 回だけ走る', async () => {
			base.slackBotToken = 'xoxb-t';
			await db
				.insert(userIntegration)
				.values({ userId: member.id, provider: 'slack', externalId: 'U_MEMBER' });
			await create(
				Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, assigneeId: member.id }))
			);
			await Promise.all(base.pending);
			const posts = base.fetched.filter((f) => f.url.endsWith('chat.postMessage'));
			expect(posts).toHaveLength(1);
			const body = posts[0].body as { channel: string; text: string };
			expect(body.channel).toBe('U_MEMBER');
			expect(body.text).toContain('adminさんが ACME で 30 件の課題をあなたに割り当てました。');
		});

		it('1 件 API（createIssue）の通知は従来どおり assigned', async () => {
			await createIssue(as(admin), 'ACME', { title: 'A', assigneeId: member.id });
			const rows = await notes();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ userId: member.id, type: 'assigned', count: null });
			expect(rows[0].issueId).not.toBeNull();
		});
	});
});
