import { beforeEach, describe, expect, it } from 'vitest';
import { ISSUE_SORT_KEYS, type IssueSort } from '#lib/issue-sort.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import {
	createCategory,
	createMilestone,
	listCategories,
	listIssueTypes,
	listMilestones
} from './issue-fields';
import { getIssueListRows, getNewIssueRows } from './issue-list';
import {
	createIssue,
	deleteIssue,
	listDeletedIssues,
	listIssues,
	listParentCandidates,
	type IssueFilters
} from './issues';
import { listAssignableUsers, requireProject } from './projects';

describe('getIssueListRows', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', 'Admin');
		member = await seedUser(db, 'member', 'Member');
		guest = await seedUser(db, 'guest', 'Guest');
		outsider = await seedUser(db, 'member', 'Outsider');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		// 同じ番号の課題や同じ名前のカテゴリーがある別のプロジェクト。混ざらないこと
		await seedProject(db, { key: 'OTHER', members: [outsider] });
		for (const key of ['OTHER', 'ACME']) {
			await createCategory(as(admin), key, { name: `${key} カテゴリー` });
			await createMilestone(as(admin), key, { name: `${key} v1`, releaseDate: '2026-12-01' });
			await createMilestone(as(admin), key, { name: `${key} バックログ` });
		}
		await createIssue(as(outsider), 'OTHER', { title: '別プロジェクトの課題' });
		const [cat] = await listCategories(as(admin), 'ACME');
		const [ms] = await listMilestones(as(admin), 'ACME');
		const [, bugType] = await listIssueTypes(as(admin), 'ACME');
		await createIssue(as(member), 'ACME', {
			title: 'ログイン画面の修正',
			assigneeIds: [guest.id, member.id],
			categoryIds: [cat.id],
			milestoneId: ms.id,
			typeId: bugType.id,
			priority: 'high',
			startDate: '2026-11-01',
			dueDate: '2026-11-30'
		});
		await createIssue(as(guest), 'ACME', {
			title: '一覧の表示',
			status: 'in_progress',
			dueDate: '2026-11-10'
		});
		await createIssue(as(member), 'ACME', { title: '親子の整理', assigneeIds: [member.id] });
		await createIssue(as(member), 'ACME', { title: '消す課題' });
		await deleteIssue(as(member), 'ACME', 4);
	});

	async function expected(actor: Actor, filters: IssueFilters, sort: IssueSort) {
		const ctx = as(actor);
		const p = await requireProject(ctx, 'ACME');
		return {
			project: p,
			issues: await listIssues(ctx, 'ACME', filters, sort),
			assignees: await listAssignableUsers(db, p.id),
			categories: await listCategories(ctx, 'ACME'),
			milestones: await listMilestones(ctx, 'ACME'),
			deletedIssues: await listDeletedIssues(ctx, 'ACME')
		};
	}

	it('returns the same rows as the single-purpose functions for each filter', async () => {
		const [cat] = await listCategories(as(admin), 'ACME');
		const [ms] = await listMilestones(as(admin), 'ACME');
		const [, bugType] = await listIssueTypes(as(admin), 'ACME');
		const sort: IssueSort = { key: 'number', order: 'desc' };
		const cases: IssueFilters[] = [
			{},
			{ status: 'in_progress' },
			{ priority: 'high' },
			{ assigneeId: member.id },
			{ assigneeId: 'none' },
			{ categoryId: cat.id },
			{ categoryId: 'none' },
			{ typeId: bugType.id },
			{ milestoneId: ms.id },
			{ milestoneId: 'none' },
			{ q: '一覧' },
			{ q: 'ACME-3' },
			{ q: '#1' }
		];
		for (const filters of cases) {
			const rows = await getIssueListRows(as(member), 'ACME', filters, sort);
			expect(rows, JSON.stringify(filters)).toEqual(await expected(member, filters, sort));
		}
	});

	it('returns the same rows as the single-purpose functions for each sort', async () => {
		for (const key of ISSUE_SORT_KEYS) {
			for (const order of ['asc', 'desc'] as const) {
				const sort = { key, order };
				expect(await getIssueListRows(as(guest), 'ACME', {}, sort)).toEqual(
					await expected(guest, {}, sort)
				);
			}
		}
		expect(await getIssueListRows(as(admin), 'ACME', {}, { key: 'number', order: 'asc' })).toEqual(
			await expected(admin, {}, { key: 'number', order: 'asc' })
		);
	});

	it('hides projects the actor has not joined', async () => {
		const sort: IssueSort = { key: 'number', order: 'desc' };
		await expect(getIssueListRows(as(outsider), 'ACME', {}, sort)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(getIssueListRows(as(admin), 'NOPE', {}, sort)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('reads everything in one round trip', async () => {
		const before = roundTrips(db);
		await getIssueListRows(as(member), 'ACME', { q: 'ACME-1' }, { key: 'due', order: 'asc' });
		expect(roundTrips(db) - before).toBe(1);
	});
});

describe('getNewIssueRows', () => {
	it('returns the same rows as the single-purpose functions in one round trip', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const as = (a: Actor) => ctxOf(base, a);
		const admin = await seedUser(db, 'admin', 'Admin');
		const member = await seedUser(db, 'member', 'Member');
		const viewer = await seedUser(db, 'viewer', 'Viewer');
		const outsider = await seedUser(db, 'member', 'Outsider');
		await seedProject(db, { key: 'ACME', members: [member, viewer] });
		await seedProject(db, { key: 'OTHER', members: [outsider] });
		for (const key of ['OTHER', 'ACME']) {
			await createCategory(as(admin), key, { name: `${key} カテゴリー` });
			await createMilestone(as(admin), key, { name: `${key} v1` });
			await createIssue(as(admin), key, { title: `${key} 親` });
		}
		await createIssue(as(admin), 'ACME', { title: '子', parentNumber: 1 });
		const ctx = as(member);
		const p = await requireProject(ctx, 'ACME');
		const before = roundTrips(db);
		const rows = await getNewIssueRows(ctx, 'ACME');
		expect(roundTrips(db) - before).toBe(1);
		expect(rows).toEqual({
			project: p,
			assignable: await listAssignableUsers(db, p.id),
			categories: await listCategories(ctx, 'ACME'),
			milestones: await listMilestones(ctx, 'ACME'),
			parentCandidates: await listParentCandidates(ctx, 'ACME')
		});
		await expect(getNewIssueRows(as(outsider), 'ACME')).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(getNewIssueRows(as(viewer), 'ACME')).rejects.toMatchObject({
			code: 'forbidden'
		});
	});
});
