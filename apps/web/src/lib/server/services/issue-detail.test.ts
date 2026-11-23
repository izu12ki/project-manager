import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { user as userTable } from '../db/schema';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import { getIssueDetailRows } from './issue-detail';
import {
	createCategory,
	createMilestone,
	listCategories,
	listIssueTypes,
	listMilestones,
	listStatuses
} from './issue-fields';
import { createIssue, deleteIssue, getIssue, listParentCandidates } from './issues';
import { listAssignableUsers } from './projects';

describe('getIssueDetailRows', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	let acmeId: string;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', 'Admin');
		member = await seedUser(db, 'member', 'Member');
		guest = await seedUser(db, 'guest', 'Guest');
		outsider = await seedUser(db, 'member', 'Outsider');
		({ id: acmeId } = await seedProject(db, { key: 'ACME', members: [member, guest] }));
		// 同じ番号の課題や同じ名前のカテゴリーがある別のプロジェクト。混ざらないこと
		await seedProject(db, { key: 'OTHER', members: [outsider] });
		for (const key of ['OTHER', 'ACME']) {
			await createCategory(as(admin), key, { name: `${key} カテゴリー` });
			await createMilestone(as(admin), key, { name: `${key} v1`, releaseDate: '2026-12-01' });
		}
		await createIssue(as(outsider), 'OTHER', { title: '別プロジェクトの課題' });
		await createIssue(as(outsider), 'OTHER', { title: '別プロジェクトの子', parentNumber: 1 });
	});

	it('課題・子課題・選択肢を、個別の取得と同じ内容で返す', async () => {
		await createIssue(as(member), 'ACME', { title: '親', assigneeIds: [guest.id, member.id] });
		await createIssue(as(member), 'ACME', {
			title: '子 B',
			parentNumber: 1,
			assigneeIds: [guest.id]
		});
		await createIssue(as(member), 'ACME', { title: '子 削除', parentNumber: 1 });
		await createIssue(as(member), 'ACME', { title: '子 C', parentNumber: 1 });
		await deleteIssue(as(member), 'ACME', 3);

		const ctx = as(member);
		const got = await getIssueDetailRows(ctx, 'ACME', 1);
		const { project, issue } = await getIssue(ctx, 'ACME', 1);
		expect(got.project).toEqual(project);
		expect(got.issue).toEqual(issue);
		expect(got.issue.assignees.map((u) => u.name)).toEqual(['Guest', 'Member']);
		expect(got.children).toEqual([
			expect.objectContaining({
				number: 2,
				title: '子 B',
				assignees: [{ id: guest.id, name: 'Guest' }]
			}),
			expect.objectContaining({ number: 4, title: '子 C', assignees: [] })
		]);
		expect(got.statuses).toEqual(await listStatuses(ctx, 'ACME'));
		expect(got.issueTypes).toEqual(await listIssueTypes(ctx, 'ACME'));
		expect(got.categories).toEqual(await listCategories(ctx, 'ACME'));
		expect(got.categories.map((c) => c.name)).toEqual(['ACME カテゴリー']);
		expect(got.milestones).toEqual(await listMilestones(ctx, 'ACME'));
		expect(got.assignees).toEqual(
			(await listAssignableUsers(db, acmeId)).map((u) => ({ ...u, disabled: false }))
		);
	});

	it('子課題の親は番号で引くので、別プロジェクトの同じ番号の課題の子は混ざらない', async () => {
		await createIssue(as(member), 'ACME', { title: '親' });
		const got = await getIssueDetailRows(as(member), 'ACME', 1);
		expect(got.issue.title).toBe('親');
		expect(got.children).toEqual([]);
	});

	it('子課題だけの担当者も名前を引く（別プロジェクトの同じ番号の課題の担当者は混ざらない）', async () => {
		await createIssue(as(outsider), 'OTHER', {
			title: '別プロジェクトの子 2',
			parentNumber: 1,
			assigneeIds: [outsider.id]
		});
		await createIssue(as(member), 'ACME', { title: '親', assigneeIds: [guest.id] });
		await createIssue(as(member), 'ACME', {
			title: '子',
			parentNumber: 1,
			assigneeIds: [member.id]
		});
		const got = await getIssueDetailRows(as(member), 'ACME', 1);
		expect(got.issue.assignees).toEqual([{ id: guest.id, name: 'Guest' }]);
		expect(got.children.map((c) => c.assignees)).toEqual([[{ id: member.id, name: 'Member' }]]);
	});

	it('無効化された担当者は、名前を出したまま選択肢の末尾に disabled で残す', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		const got = await getIssueDetailRows(as(member), 'ACME', 1);
		expect(got.issue.assignees).toEqual([{ id: guest.id, name: 'Guest' }]);
		expect(got.assignees.at(-1)).toEqual({
			id: guest.id,
			name: 'Guest',
			role: 'guest',
			disabled: true
		});
		expect(got.assignees.filter((u) => u.id === guest.id)).toHaveLength(1);
	});

	it('参加していないプロジェクトの課題は見せない（管理者は見られる）', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await expect(getIssueDetailRows(as(outsider), 'ACME', 1)).rejects.toMatchObject({
			code: 'not_found',
			message: 'プロジェクトが見つかりません'
		});
		await expect(getIssueDetailRows(as(member), 'NOPE', 1)).rejects.toMatchObject({
			code: 'not_found',
			message: 'プロジェクトが見つかりません'
		});
		await expect(getIssueDetailRows(as(member), 'ACME', 9)).rejects.toMatchObject({
			code: 'not_found',
			message: '課題が見つかりません'
		});
		expect((await getIssueDetailRows(as(admin), 'ACME', 1)).issue.title).toBe('A');
	});
});

describe('listParentCandidates', () => {
	it('子課題でない、削除していない課題を新しい順に返し、指定した課題は除く', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const member = await seedUser(db, 'member');
		await seedProject(db, { key: 'ACME', members: [member] });
		const ctx = ctxOf(base, member);
		await createIssue(ctx, 'ACME', { title: '親' });
		await createIssue(ctx, 'ACME', { title: '子', parentNumber: 1 });
		await createIssue(ctx, 'ACME', { title: '単独' });
		await createIssue(ctx, 'ACME', { title: '削除' });
		await deleteIssue(ctx, 'ACME', 4);
		expect(await listParentCandidates(ctx, 'ACME')).toEqual([
			{ number: 3, title: '単独' },
			{ number: 1, title: '親' }
		]);
		expect(await listParentCandidates(ctx, 'ACME', 3)).toEqual([{ number: 1, title: '親' }]);
	});
});

describe('getIssueDetailRows の往復', () => {
	it('reads the detail in one round trip, with names of disabled assignees of children', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin', 'Admin');
		const member = await seedUser(db, 'member', 'Member');
		const guest = await seedUser(db, 'guest', 'Guest');
		const as = (a: Actor) => ctxOf(base, a);
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(member), 'ACME', { title: '親', assigneeIds: [member.id] });
		await createIssue(as(member), 'ACME', {
			title: '子',
			parentNumber: 1,
			assigneeIds: [guest.id]
		});
		await db.update(userTable).set({ disabledAt: new Date() }).where(eq(userTable.id, guest.id));
		const before = roundTrips(db);
		const rows = await getIssueDetailRows(as(admin), 'ACME', 1);
		expect(roundTrips(db) - before).toBe(1);
		expect(rows.issue.assignees).toEqual([{ id: member.id, name: 'Member' }]);
		expect(rows.children.map((c) => c.assignees)).toEqual([[{ id: guest.id, name: 'Guest' }]]);
	});
});
