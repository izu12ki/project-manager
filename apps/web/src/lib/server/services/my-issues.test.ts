import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue as issueTable } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { createIssue, deleteIssue } from './issues';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
import { listMyIssues } from './my-issues';
import { setProjectArchived } from './projects';

describe('listMyIssues', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, me: Actor, other: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const keys = async (a: Actor, filters: Parameters<typeof listMyIssues>[1] = {}) =>
		(await listMyIssues(as(a), filters)).issues.map((i) => `${i.projectKey}-${i.number}`);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		me = await seedUser(db, 'member', 'me');
		other = await seedUser(db, 'member', 'other');
		await seedProject(db, { key: 'ACME', members: [me, other] });
		await seedProject(db, { key: 'BETA', name: 'Beta', members: [me, other] });
		await seedProject(db, { key: 'GAMMA', members: [other] });
	});

	it('参加しているプロジェクトをまたいで、自分が担当している完了以外の課題を期限の近い順に返す', async () => {
		await createIssue(as(other), 'ACME', {
			title: 'A1',
			assigneeIds: [me.id],
			dueDate: '2026-12-20'
		});
		await createIssue(as(other), 'ACME', { title: 'A2', assigneeIds: [other.id] });
		await createIssue(as(other), 'BETA', { title: 'B1', assigneeIds: [other.id, me.id] });
		await createIssue(as(other), 'BETA', {
			title: 'B2',
			assigneeIds: [me.id],
			dueDate: '2026-12-01'
		});
		await createIssue(as(other), 'BETA', { title: 'B3', assigneeIds: [me.id], status: 'done' });
		await createIssue(as(other), 'BETA', { title: 'B4', assigneeIds: [me.id] });
		await deleteIssue(as(other), 'BETA', 4);

		const { issues, total } = await listMyIssues(as(me), {});
		expect(issues.map((i) => `${i.projectKey}-${i.number}`)).toEqual([
			'BETA-2',
			'ACME-1',
			'BETA-1'
		]);
		expect(total).toBe(3);
		expect(issues[0]).toMatchObject({
			projectName: 'Beta',
			title: 'B2',
			status: 'todo',
			statusName: '未着手'
		});
		expect(issues[2].assignees.map((u) => u.name)).toEqual(['other', 'me']);
	});

	it('ステータスは完了だけ・すべてにも切り替えられる', async () => {
		await createIssue(as(other), 'ACME', { title: 'A1', assigneeIds: [me.id] });
		await createIssue(as(other), 'ACME', { title: 'A2', assigneeIds: [me.id], status: 'done' });

		expect(await keys(me, { status: 'done' })).toEqual(['ACME-2']);
		expect((await keys(me, { status: 'all' })).sort()).toEqual(['ACME-1', 'ACME-2']);
	});

	it('登録した課題に切り替えられる', async () => {
		await createIssue(as(me), 'ACME', { title: 'A1', assigneeIds: [other.id] });
		await createIssue(as(other), 'ACME', { title: 'A2', assigneeIds: [me.id] });

		expect(await keys(me, { role: 'reporter' })).toEqual(['ACME-1']);
	});

	it('参加していないプロジェクトとアーカイブしたプロジェクトの課題は出さない', async () => {
		await createIssue(as(other), 'GAMMA', { title: 'G1' });
		// 担当のまま参加者から外れた場合
		await db
			.update(issueTable)
			.set({ assigneeIds: [me.id] })
			.where(eq(issueTable.title, 'G1'));
		await createIssue(as(other), 'BETA', { title: 'B1', assigneeIds: [me.id] });
		await setProjectArchived(as(admin), 'BETA', true);

		expect(await keys(me)).toEqual([]);
		// 管理者はすべてのプロジェクトが見られる
		await db
			.update(issueTable)
			.set({ assigneeIds: [admin.id] })
			.where(eq(issueTable.title, 'G1'));
		expect(await keys(admin)).toEqual(['GAMMA-1']);
	});

	it('ISSUE_PAGE_SIZE 件ずつのページと、条件に合う課題の総数を返す。ページをつなぐと全件が 1 回ずつ並ぶ', async () => {
		const count = ISSUE_PAGE_SIZE + 5;
		// 期限なし・更新日時が同じ課題が並んでも、ページの境目で重複・欠落しない
		for (let n = 0; n < count; n++) {
			await createIssue(as(other), n % 2 ? 'ACME' : 'BETA', {
				title: `T${n}`,
				assigneeIds: [me.id]
			});
		}
		await db.update(issueTable).set({ updatedAt: new Date('2026-11-01T00:00:00Z') });
		await createIssue(as(other), 'ACME', {
			title: 'mine-done',
			assigneeIds: [me.id],
			status: 'done'
		});

		const first = await listMyIssues(as(me), {}, 1);
		const second = await listMyIssues(as(me), {}, 2);
		expect(first.issues).toHaveLength(ISSUE_PAGE_SIZE);
		expect(second.issues).toHaveLength(5);
		expect(first.total).toBe(count);
		expect(second.total).toBe(count);
		const ids = [...first.issues, ...second.issues].map((i) => i.id);
		expect(new Set(ids).size).toBe(count);
		expect((await listMyIssues(as(me), {}, 3)).issues).toEqual([]);
		expect((await listMyIssues(as(me), { status: 'done' })).total).toBe(1);
	});
});
