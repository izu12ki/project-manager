// 課題一覧・起票の画面に要る行を 1 回の batch（D1 への 1 往復）で引く。方式は project-access.ts の先頭を参照
import type { IssueSort } from '#lib/issue-sort.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
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

export async function getIssueListRows(
	ctx: AppContext,
	key: string,
	filters: IssueFilters,
	sort: IssueSort
) {
	const { db } = ctx;
	const of = ofProject(db, key);
	const [access, issues, assignees, categories, milestones, deletedIssues] = await ctx.readBatch([
		projectAccessQuery(ctx, key),
		issueListQuery(db, filterConds(key, of, filters), sortOrder(sort)),
		assignableUsersQuery(db, of),
		categoriesQuery(db, of),
		milestonesQuery(db, of),
		deletedIssuesQuery(db, of)
	]);
	return {
		project: checkProjectAccess(ctx, access),
		issues: toIssueListItems(issues),
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
