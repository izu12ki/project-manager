// 課題一覧・起票の画面に要る行を 1 回の batch（D1 への 1 往復）で引く。方式は project-access.ts の先頭を参照
import { sql, type SQL } from 'drizzle-orm';
import { DEFAULT_ISSUE_SORT, type IssueSort } from '#lib/issue-sort.ts';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { cachedRead } from '../db/cached-read';
import { issue } from '../db/schema';
import { categoriesQuery, milestonesQuery } from './issue-fields';
import {
	deletedIssuesQuery,
	filterConds,
	issueListViewQuery,
	parentByNumberQuery,
	parentCandidatesQuery,
	sortOrder,
	toIssueListViewItems,
	type IssueFilters
} from './issues';
import { cachedByKey, checkProjectAccess, ofProject, projectAccessRead } from './project-access';
import { assignableUsersQuery } from './projects';

// 組み立てを使い回す（db/cached-read.ts）
const assignableOf = cachedByKey(assignableUsersQuery);
const categoriesOf = cachedByKey(categoriesQuery);
const milestonesOf = cachedByKey(milestonesQuery);
const deletedIssuesOf = cachedByKey(deletedIssuesQuery);
const parentCandidatesOf = cachedByKey((db, of) => parentCandidatesQuery(db, of));

function listPageQuery(db: DB, where: SQL | undefined, sort: IssueSort) {
	return issueListViewQuery(db, where, sortOrder(sort));
}

/** 条件に合う課題の数（課題一覧と API の一覧で使う） */
export function countQuery(db: DB, where: SQL | undefined) {
	return db
		.select({ total: sql<number>`count(*)`.as('issue_total') })
		.from(issue)
		.where(where);
}

/** 一覧を開いたときの絞り込み（完了以外）。画面の既定と同じにする（routes/projects/[key]/+page.server.ts） */
const DEFAULT_LIST_FILTERS: IssueFilters = { status: 'open' };
const isDefaultFilters = (filters: IssueFilters) =>
	filters.status === DEFAULT_LIST_FILTERS.status &&
	Object.entries(filters).every(([k, v]) => k === 'status' || v === undefined);

// 既定の絞り込みの一覧（一覧を開いたとき）の 1 ページと件数は、並び順ごとに組み立てを使い回す。
// ほかの絞り込みでは値によって文の形が変わる（'none' など）ので、そのときは毎回組み立てる。
// filterConds のキーはキーワード検索にだけ使うので、既定の絞り込みでは使われない
const defaultCount = cachedRead(['key'], (db, p) =>
	countQuery(db, filterConds('', ofProject(db, p.key), DEFAULT_LIST_FILTERS))
);
const defaultPages = new Map<string, ReturnType<typeof defaultPageRead>>();
function defaultPageRead(sort: IssueSort) {
	return cachedRead(['key', 'limit', 'offset'], (db, p) =>
		listPageQuery(db, filterConds('', ofProject(db, p.key), DEFAULT_LIST_FILTERS), sort)
			.limit(p.limit)
			.offset(p.offset)
	);
}
function defaultPage(sort: IssueSort) {
	const id = `${sort.key} ${sort.order}`;
	let read = defaultPages.get(id);
	if (!read) defaultPages.set(id, (read = defaultPageRead(sort)));
	return read;
}
// 既定の並び順（一覧を開いたとき）の分は、起動時に組み立てられるよう先に作っておく（buildCachedReads）
defaultPage(DEFAULT_ISSUE_SORT);

/**
 * 課題一覧の 1 ページ分（ISSUE_PAGE_SIZE 件）と、条件に合う課題の総数。
 * 全件を読むと、Backlog から移した数千件のプロジェクトで 1 回の表示の CPU 時間が 100ms を超えるため
 */
export async function getIssueListRows(
	ctx: AppContext,
	key: string,
	filters: IssueFilters,
	sort: IssueSort,
	page = 1
) {
	const { db } = ctx;
	const offset = (page - 1) * ISSUE_PAGE_SIZE;
	const filtered = !isDefaultFilters(filters);
	const where = filtered ? filterConds(key, ofProject(db, key), filters) : undefined;
	const [access, issues, [{ total }], assignees, categories, milestones, deletedIssues] =
		await ctx.readBatch([
			projectAccessRead(ctx, key),
			filtered
				? listPageQuery(db, where, sort).limit(ISSUE_PAGE_SIZE).offset(offset)
				: defaultPage(sort)(db, { key, limit: ISSUE_PAGE_SIZE, offset }),
			filtered ? countQuery(db, where) : defaultCount(db, { key }),
			assignableOf(db, key),
			categoriesOf(db, key),
			milestonesOf(db, key),
			deletedIssuesOf(db, key)
		]);
	return {
		project: checkProjectAccess(ctx, access),
		issues: toIssueListViewItems(issues).map(({ categoriesJson, ...i }) => ({
			...i,
			categoryNames: JSON.parse(categoriesJson) as string[]
		})),
		total,
		assignees,
		categories,
		milestones,
		deletedIssues
	};
}

/**
 * 起票の画面。起票できない人（閲覧者）は forbidden。
 * parentNumber（「子課題を追加」から来たときの親）は、候補（新しいものから一定数）に入らない古い課題でも引く
 */
export async function getNewIssueRows(ctx: AppContext, key: string, parentNumber?: number) {
	const { db } = ctx;
	const of = ofProject(db, key);
	const [access, assignable, categories, milestones, parentCandidates, parents] =
		await ctx.readBatch([
			projectAccessRead(ctx, key),
			assignableOf(db, key),
			categoriesOf(db, key),
			milestonesOf(db, key),
			parentCandidatesOf(db, key),
			// 番号は 1 から振るので、0 はどの課題にも当たらない
			parentByNumberQuery(db, of, parentNumber ?? 0)
		]);
	const project = checkProjectAccess(ctx, access);
	authorize(ctx.actor, 'issue:create');
	return {
		project,
		assignable,
		categories,
		milestones,
		parentCandidates,
		parent: parents[0] ?? null
	};
}
