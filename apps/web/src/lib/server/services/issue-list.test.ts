import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ISSUE_SORT_KEYS, type IssueSort } from '#lib/issue-sort.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue } from '../db/schema';
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
		// listIssues も同じ issueListQuery を使うので、課題の番号は期待値を直接書いて確かめる
		const cases: [IssueFilters, number[]][] = [
			[{}, [3, 2, 1]],
			[{ status: 'in_progress' }, [2]],
			[{ priority: 'high' }, [1]],
			[{ assigneeId: member.id }, [3, 1]],
			[{ assigneeId: 'none' }, [2]],
			[{ categoryId: cat.id }, [1]],
			[{ categoryId: 'none' }, [3, 2]],
			[{ typeId: bugType.id }, [1]],
			[{ milestoneId: ms.id }, [1]],
			[{ milestoneId: 'none' }, [3, 2]],
			[{ q: '一覧' }, [2]],
			[{ q: 'ACME-3' }, [3]],
			[{ q: '#1' }, [1]]
		];
		for (const [filters, numbers] of cases) {
			const rows = await getIssueListRows(as(member), 'ACME', filters, sort);
			expect(
				rows.issues.map((i) => i.number),
				JSON.stringify(filters)
			).toEqual(numbers);
			expect(rows, JSON.stringify(filters)).toEqual(await expected(member, filters, sort));
		}
	});

	it('returns the same rows as the single-purpose functions for each sort', async () => {
		// 登録日・更新日が同じミリ秒に重ならないよう、ずらして入れる
		const at = (day: number) => new Date(Date.UTC(2026, 0, day));
		for (const [number, created, updated] of [
			[1, 3, 1],
			[2, 1, 3],
			[3, 2, 2]
		]) {
			await db
				.update(issue)
				.set({ createdAt: at(created), updatedAt: at(updated) })
				.where(and(eq(issue.projectId, acmeId), eq(issue.number, number)));
		}
		// listIssues も同じ issueListQuery を使うので、課題の並びは期待値を直接書いて確かめる
		const numbers: Record<IssueSort['key'], Record<IssueSort['order'], number[]>> = {
			number: { asc: [1, 2, 3], desc: [3, 2, 1] },
			// 開始日・期限が空の課題は、どちらの向きでも末尾（その中はキーの降順）
			start: { asc: [1, 3, 2], desc: [1, 3, 2] },
			due: { asc: [2, 1, 3], desc: [1, 2, 3] },
			created: { asc: [2, 3, 1], desc: [1, 3, 2] },
			updated: { asc: [1, 3, 2], desc: [2, 3, 1] }
		};
		for (const key of ISSUE_SORT_KEYS) {
			for (const order of ['asc', 'desc'] as const) {
				const sort = { key, order };
				const rows = await getIssueListRows(as(guest), 'ACME', {}, sort);
				expect(
					rows.issues.map((i) => i.number),
					`${key} ${order}`
				).toEqual(numbers[key][order]);
				expect(rows).toEqual(await expected(guest, {}, sort));
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

	it('treats a project key from the URL as plain text in the keyword search', async () => {
		const sort: IssueSort = { key: 'number', order: 'desc' };
		// 正規表現として解釈すると、構文エラーになったり（A(）、照合に指数関数的な時間がかかったり（(a+)+）する
		await expect(getIssueListRows(as(admin), 'A(', { q: '12' }, sort)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(
			getIssueListRows(as(admin), '(a+)+', { q: `${'a'.repeat(28)}!` }, sort)
		).rejects.toMatchObject({ code: 'not_found' });
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
