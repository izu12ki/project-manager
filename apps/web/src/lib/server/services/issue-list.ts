// 課題一覧・起票の画面に要る行を 1 回の batch（D1 への 1 往復）で引く。方式は project-access.ts の先頭を参照
import { sql } from 'drizzle-orm';
import type { IssueSort } from '#lib/issue-sort.ts';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { issue } from '../db/schema';
import { categoriesQuery, milestonesQuery } from './issue-fields';
import {
	deletedIssuesQuery,
	filterConds,
	issueListQuery,
	parentCandidatesQuery,
	sortOrder,
	toIssueListItems,
	type IssueFilters
} from './issues';
import { checkProjectAccess, ofProject, projectAccessQuery } from './project-access';
import { assignableUsersQuery } from './projects';

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
	const of = ofProject(db, key);
	const where = filterConds(key, of, filters);
	const [access, issues, [{ total }], assignees, categories, milestones, deletedIssues] =
		await ctx.readBatch([
			projectAccessQuery(ctx, key),
			issueListQuery(db, where, sortOrder(sort))
				.limit(ISSUE_PAGE_SIZE)
				.offset((page - 1) * ISSUE_PAGE_SIZE),
			db
				.select({ total: sql<number>`count(*)`.as('issue_total') })
				.from(issue)
				.where(where),
			assignableUsersQuery(db, of),
			categoriesQuery(db, of),
			milestonesQuery(db, of),
			deletedIssuesQuery(db, of)
		]);
	return {
		project: checkProjectAccess(ctx, access),
		issues: toIssueListItems(issues),
		total,
		assignees,
		categories,
		milestones,
		deletedIssues
	};
}

/** 起票の画面。起票できない人（閲覧者）は forbidden */
export async function getNewIssueRows(ctx: AppContext, key: string) {
	const { db } = ctx;
	const of = ofProject(db, key);
	const [access, assignable, categories, milestones, parentCandidates] = await ctx.readBatch([
		projectAccessQuery(ctx, key),
		assignableUsersQuery(db, of),
		categoriesQuery(db, of),
		milestonesQuery(db, of),
		parentCandidatesQuery(db, of)
	]);
	const project = checkProjectAccess(ctx, access);
	authorize(ctx.actor, 'issue:create');
	return { project, assignable, categories, milestones, parentCandidates };
}
