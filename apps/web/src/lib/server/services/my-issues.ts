// 自分の課題（プロジェクトをまたいだ一覧）。Backlog のホームの「自分の課題」にあたる
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteSelect } from 'drizzle-orm/sqlite-core';
import type { ColorName } from '#lib/labels.ts';
import { ISSUE_PAGE_SIZE } from '#lib/pagination.ts';
import type { AppContext } from '../context';
import { inList } from '../db/limits';
import { issue, issueAssignee, issueStatus, project, projectMember } from '../db/schema';
import { selectIssueListView, statusCond, toIssueListViewItems } from './issues';

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
 * 期限の近い順（期限なしは末尾）、同じ期限の中は更新の新しい順。ページの境目で順が揺れないよう、最後に id で並べる。
 *
 * D1 の読み取り行数を抑えるため、プロジェクトの課題をすべては読まない。担当している課題は issue_assignee
 * （担当者・完了かどうかの索引）から、登録した課題は issue_reporter_idx から、自分の課題だけを引く。
 * 1 ページ分の ID を選んでから行に出す列を引く（選びながら引くと、担当者の名前などを条件に合う全件で引く）
 */
export async function listMyIssues(ctx: AppContext, filters: MyIssueFilters, page = 1) {
	const { db } = ctx;
	const me = ctx.actor.id;
	const status = filters.status ?? 'open';
	// 見られるプロジェクトを先に絞る（課題ごとに参加を確かめると、その分の行も読む）
	const visibleProjects =
		ctx.actor.role === 'admin'
			? db.select({ id: project.id }).from(project).where(isNull(project.archivedAt))
			: db
					.select({ id: projectMember.projectId })
					.from(projectMember)
					.innerJoin(project, eq(project.id, projectMember.projectId))
					.where(and(eq(projectMember.userId, me), isNull(project.archivedAt)));
	const visible = and(isNull(issue.deletedAt), inList(issue.projectId, visibleProjects));
	// 自分の課題に絞る。担当している課題は issue_assignee を先に読む（SQLite が結合の順を選ぶ）
	const mine = <Q extends SQLiteSelect>(q: Q) =>
		filters.role === 'reporter'
			? q.where(
					and(eq(issue.reporterId, me), status === 'all' ? undefined : statusCond(status), visible)
				)
			: q
					.innerJoin(issueAssignee, eq(issueAssignee.issueId, issue.id))
					.where(
						and(
							eq(issueAssignee.userId, me),
							status === 'all' ? undefined : eq(issueAssignee.done, status === 'done'),
							visible
						)
					);
	const order: SQL[] = [
		sql`${issue.dueDate} is null`,
		asc(issue.dueDate),
		desc(issue.updatedAt),
		asc(issue.id)
	];
	const shown = mine(db.select({ id: issue.id }).from(issue).$dynamic())
		.orderBy(...order)
		.limit(ISSUE_PAGE_SIZE)
		.offset((page - 1) * ISSUE_PAGE_SIZE);
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
			.where(inList(issue.id, shown))
			.orderBy(...order),
		mine(
			db
				.select({ total: sql<number>`count(*)`.as('issue_total') })
				.from(issue)
				.$dynamic()
		)
	]);
	return { issues: toIssueListViewItems(rows), total };
}
