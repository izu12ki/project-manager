// 自分の課題（プロジェクトをまたいだ一覧）。Backlog のホームの「自分の課題」にあたる
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { ColorName } from '#lib/labels.ts';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
import type { AppContext } from '../context';
import { issue, issueStatus, project, projectMember } from '../db/schema';
import { idsCond, selectIssueListView, statusCond, toIssueListViewItems } from './issues';

/**
 * role は担当している課題（assignee、既定）か登録した課題（reporter）。
 * status は完了以外（open、既定）・完了（done）・すべて（all）
 */
export interface MyIssueFilters {
	role?: 'assignee' | 'reporter';
	status?: 'open' | 'done' | 'all';
}

/**
 * 見られるプロジェクト（管理者はすべて、ほかは参加しているもの）のうち、アーカイブしていないものの課題の
 * 1 ページ分（ISSUE_PAGE_SIZE 件）と、条件に合う課題の総数。
 * 期限の近い順（期限なしは末尾）、同じ期限の中は更新の新しい順。ページの境目で順が揺れないよう、最後に id で並べる
 */
export async function listMyIssues(ctx: AppContext, filters: MyIssueFilters, page = 1) {
	const { db } = ctx;
	const me = ctx.actor.id;
	const visible: SQL | undefined =
		ctx.actor.role === 'admin'
			? undefined
			: sql`exists (select 1 from ${projectMember}
				where ${projectMember.projectId} = ${issue.projectId} and ${projectMember.userId} = ${me})`;
	const where = and(
		isNull(issue.deletedAt),
		isNull(project.archivedAt),
		visible,
		filters.role === 'reporter' ? eq(issue.reporterId, me) : idsCond(issue.assigneeIds, me),
		filters.status === 'all' ? undefined : statusCond(filters.status ?? 'open')
	);
	const [rows, [{ total }]] = await ctx.readBatch([
		selectIssueListView(db, {
			projectKey: sql<string>`${project.key}`.as('project_key'),
			projectName: sql<string>`${project.name}`.as('project_name'),
			statusName: sql<string | null>`${issueStatus.name}`.as('status_name'),
			statusColor: sql<ColorName | null>`${issueStatus.color}`.as('status_color')
		})
			.innerJoin(project, eq(project.id, issue.projectId))
			.leftJoin(
				issueStatus,
				and(eq(issueStatus.projectId, issue.projectId), eq(issueStatus.key, issue.status))
			)
			.where(where)
			.orderBy(
				sql`${issue.dueDate} is null`,
				asc(issue.dueDate),
				desc(issue.updatedAt),
				asc(issue.id)
			)
			.limit(ISSUE_PAGE_SIZE)
			.offset((page - 1) * ISSUE_PAGE_SIZE),
		db
			.select({ total: sql<number>`count(*)`.as('issue_total') })
			.from(issue)
			.innerJoin(project, eq(project.id, issue.projectId))
			.where(where)
	]);
	return { issues: toIssueListViewItems(rows), total };
}
