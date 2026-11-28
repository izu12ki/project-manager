import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ISSUE_SORT_KEYS, type IssueSort } from '#lib/issue-sort.ts';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
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
	PARENT_CANDIDATE_LIMIT,
	type IssueFilters
} from './issues';
import { listAssignableUsers, requireProject } from './projects';

/** listIssues の列のうち、一覧の画面（getIssueListRows）では読まないもの */
const NOT_IN_LIST_VIEW = [
	'id',
	'assignees',
	'categories',
	'typeId',
	'resolution',
	'position',
	'assigneeIds',
	'parentId',
	'categoryIds',
	'milestoneId',
	'reporterId'
];

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
		const issues = await listIssues(ctx, 'ACME', filters, sort);
		return {
			project: p,
			// 一覧の画面は表示しない列を読まない。担当者・カテゴリーは名前だけ
			issues: issues.map((i) => ({
				...Object.fromEntries(Object.entries(i).filter(([k]) => !NOT_IN_LIST_VIEW.includes(k))),
				assigneeNames: i.assignees.map((u) => u.name),
				categoryNames: i.categories.map((c) => c.name)
			})),
			total: issues.length,
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
			// 一覧を開いたとき（既定の絞り込み）。組み立てを使い回す文で引く
			[{ status: 'open' }, [3, 2, 1]],
			[{ status: 'in_progress' }, [2]],
			[{ priority: 'high' }, [1]],
			[{ assigneeId: member.id }, [3, 1]],
			[{ assigneeId: 'none' }, [2]],
			[{ categoryId: cat.id }, [1]],
			[{ categoryId: 'none' }, [3, 2]],
			[{ typeId: bugType.id }, [1]],
			[{ milestoneId: ms.id }, [1]],
			[{ milestoneId: 'none' }, [3, 2]],
			[{ unscheduled: true }, [3]],
			[{ unscheduled: true, status: 'open' }, [3]],
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

	it('担当者とステータスを組み合わせても、完了した課題・ほかのプロジェクトの課題が混ざらない', async () => {
		await createIssue(as(member), 'ACME', {
			title: '完了した課題',
			assigneeIds: [member.id],
			status: 'done'
		});
		// 担当者の索引（issue_assignee）から読むので、ほかのプロジェクトで担当している課題も索引には出てくる
		await db
			.update(issue)
			.set({ assigneeIds: [member.id] })
			.where(eq(issue.title, '別プロジェクトの課題'));
		const sort: IssueSort = { key: 'number', order: 'desc' };
		const cases: [IssueFilters, number[]][] = [
			[{ assigneeId: member.id }, [5, 3, 1]],
			[{ assigneeId: member.id, status: 'open' }, [3, 1]],
			[{ assigneeId: member.id, status: 'done' }, [5]],
			[{ assigneeId: member.id, status: 'todo' }, [3, 1]],
			[{ assigneeId: member.id, status: 'open', q: 'ログイン' }, [1]],
			[{ assigneeId: guest.id, status: 'open' }, [1]],
			[{ assigneeId: 'none', status: 'open' }, [2]],
			[{ status: 'open' }, [3, 2, 1]],
			[{ status: 'done' }, [5]]
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

	it('returns one page of ISSUE_PAGE_SIZE issues and the total that matches the filters', async () => {
		const p = await requireProject(as(admin), 'ACME');
		// 既にある 3 件（#1〜#3、削除した #4）に足して、#5〜#124 の 120 件を入れる
		const rows = Array.from({ length: 120 }, (_, i) => ({
			id: `bulk-${i + 5}`,
			projectId: p.id,
			number: i + 5,
			title: `まとめて入れた課題 ${i + 5}`,
			status: i % 2 === 0 ? 'todo' : 'done',
			reporterId: admin.id,
			position: `a${i + 5}`
		}));
		// D1 の 1 文の変数は 100 個まで
		for (let i = 0; i < rows.length; i += 5) await db.insert(issue).values(rows.slice(i, i + 5));
		const sort: IssueSort = { key: 'number', order: 'asc' };
		const numbers = (rows: { issues: { number: number }[] }) => rows.issues.map((i) => i.number);

		const all = [1, 2, 3, ...Array.from({ length: 120 }, (_, i) => i + 5)];
		const pages = Math.ceil(all.length / ISSUE_PAGE_SIZE);
		for (let page = 1; page <= pages; page++) {
			const rows = await getIssueListRows(as(member), 'ACME', {}, sort, page);
			expect(rows.total).toBe(123);
			expect(numbers(rows), `page ${page}`).toEqual(
				all.slice((page - 1) * ISSUE_PAGE_SIZE, page * ISSUE_PAGE_SIZE)
			);
		}
		// 最後のページを越えると空。総数は変わらない（ページの補正は呼び出し側で行う）
		const beyond = await getIssueListRows(as(member), 'ACME', {}, sort, pages + 1);
		expect(beyond.issues).toEqual([]);
		expect(beyond.total).toBe(123);

		// 総数は絞り込みの後の件数（#5 からの偶数番目 60 件が todo、#1・#3 は todo、#2 は in_progress）
		const todoPages = Math.ceil(62 / ISSUE_PAGE_SIZE);
		const todo = await getIssueListRows(as(member), 'ACME', { status: 'todo' }, sort, todoPages);
		expect(todo.total).toBe(62);
		expect(todo.issues).toHaveLength(62 - (todoPages - 1) * ISSUE_PAGE_SIZE);
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
			parentCandidates: await listParentCandidates(ctx, 'ACME'),
			parent: null
		});
		// 親に指定した課題も同じ 1 往復で引く。子課題（#2）は親にできない
		const withParent = await getNewIssueRows(ctx, 'ACME', 1);
		expect(withParent.parent).toEqual({ number: 1, title: 'ACME 親' });
		expect((await getNewIssueRows(ctx, 'ACME', 2)).parent).toBeNull();
		await expect(getNewIssueRows(as(outsider), 'ACME')).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(getNewIssueRows(as(viewer), 'ACME')).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it(`offers the newest ${PARENT_CANDIDATE_LIMIT} parents and still finds an older one by number`, async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin', 'Admin');
		const { id: projectId } = await seedProject(db, { key: 'ACME', members: [] });
		const rows = Array.from({ length: PARENT_CANDIDATE_LIMIT + 5 }, (_, i) => ({
			id: `p-${i + 1}`,
			projectId,
			number: i + 1,
			title: `課題 ${i + 1}`,
			reporterId: admin.id,
			position: `a${i + 1}`
		}));
		// D1 の 1 文の変数は 100 個まで
		for (let i = 0; i < rows.length; i += 5) await db.insert(issue).values(rows.slice(i, i + 5));
		const got = await getNewIssueRows(ctxOf(base, admin), 'ACME', 3);
		expect(got.parentCandidates.map((c) => c.number)).toEqual(
			Array.from({ length: PARENT_CANDIDATE_LIMIT }, (_, i) => PARENT_CANDIDATE_LIMIT + 5 - i)
		);
		expect(got.parent).toEqual({ number: 3, title: '課題 3' });
	});
});
