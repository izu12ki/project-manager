// 自分の課題（プロジェクトをまたいだ一覧）。Backlog のホームの「自分の課題」にあたる
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { ColorName } from '#lib/labels.ts';
import type { AppContext } from '../context';
import { issue, issueStatus, project, projectMember } from '../db/schema';
import { idsCond, selectIssueList, statusCond, toIssueListItems } from './issues';

/** 1 回に出す件数の上限。超えた分は出さず、truncated で知らせる */
export const MY_ISSUES_LIMIT = 200;

/**
 * role は担当している課題（assignee、既定）か登録した課題（reporter）。
 * status は完了以外（open、既定）・完了（done）・すべて（all）
 */
export interface MyIssueFilters {
	role?: 'assignee' | 'reporter';
	status?: 'open' | 'done' | 'all';
}

/**
 * 見られるプロジェクト（管理者はすべて、ほかは参加しているもの）のうち、アーカイブしていないものの課題。
 * 期限の近い順（期限なしは末尾）、同じ期限の中は更新の新しい順
 */
export async function listMyIssues(ctx: AppContext, filters: MyIssueFilters) {
	const me = ctx.actor.id;
	const visible: SQL | undefined =
		ctx.actor.role === 'admin'
			? undefined
			: sql`exists (select 1 from ${projectMember}
				where ${projectMember.projectId} = ${issue.projectId} and ${projectMember.userId} = ${me})`;
	const rows = await selectIssueList(ctx.db, {
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
		.where(
			and(
				isNull(issue.deletedAt),
				isNull(project.archivedAt),
				visible,
				filters.role === 'reporter' ? eq(issue.reporterId, me) : idsCond(issue.assigneeIds, me),
				filters.status === 'all' ? undefined : statusCond(filters.status ?? 'open')
			)
		)
		.orderBy(sql`${issue.dueDate} is null`, asc(issue.dueDate), desc(issue.updatedAt))
		.limit(MY_ISSUES_LIMIT + 1);
	return {
		issues: toIssueListItems(rows.slice(0, MY_ISSUES_LIMIT)),
		truncated: rows.length > MY_ISSUES_LIMIT
	};
}
