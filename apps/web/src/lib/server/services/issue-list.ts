// 課題一覧の画面に要る行を 1 回の batch（D1 への 1 往復）で引く。方式は project-access.ts の先頭を参照
import type { IssueSort } from '#lib/issue-sort.ts';
import type { AppContext } from '../context';
import { categoriesQuery, milestonesQuery } from './issue-fields';
import {
	deletedIssuesQuery,
	filterConds,
	issueListQuery,
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
	const [access, issues, assignees, categories, milestones, deletedIssues] = await db.batch([
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
