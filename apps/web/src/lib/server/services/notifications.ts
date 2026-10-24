import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { statusName } from '$lib/labels';
import type { AppContext } from '../context';
import {
	comment,
	issue,
	issueStatus,
	notification,
	project,
	projectMember,
	user,
	type NotificationType
} from '../db/schema';
import { AppError } from '../errors';
import { excerpt } from '../notifications/format';
import { getIssue } from './issues';

export interface NotificationItem {
	id: string;
	type: NotificationType;
	summary: string;
	actorName: string;
	projectKey: string;
	issueNumber: number;
	issueTitle: string;
	href: string;
	read: boolean;
	createdAt: Date;
}

/** 自分宛てで、今もアクセスできるプロジェクトの通知 */
function mine(ctx: AppContext): SQL {
	const own = eq(notification.userId, ctx.actor.id);
	if (ctx.actor.role === 'admin') return own;
	return and(
		own,
		inArray(
			notification.issueId,
			ctx.db
				.select({ id: issue.id })
				.from(issue)
				.innerJoin(projectMember, eq(projectMember.projectId, issue.projectId))
				.where(eq(projectMember.userId, ctx.actor.id))
		)
	)!;
}

function summaryOf(r: {
	type: NotificationType;
	commentId: string | null;
	commentBody: string | null;
	fromStatus: string | null;
	toStatus: string | null;
	fromStatusName: string | null;
	toStatusName: string | null;
}): string {
	const body = r.commentBody ? excerpt(r.commentBody, 80) : '';
	switch (r.type) {
		case 'assigned':
			return '担当者に設定しました';
		case 'commented':
			return `コメントしました: ${body}`;
		case 'status_changed':
			return `${r.fromStatusName ?? statusName([], r.fromStatus!)} → ${r.toStatusName ?? statusName([], r.toStatus!)}`;
		case 'mentioned':
			return r.commentId ? `メンションしました: ${body}` : '説明でメンションしました';
	}
}

const fromStatus = alias(issueStatus, 'from_status');
const toStatus = alias(issueStatus, 'to_status');

const hrefOf = (key: string, n: number, commentId: string | null) =>
	`/projects/${key}/issues/${n}${commentId ? `#comment-${commentId}` : ''}`;

export async function listNotifications(ctx: AppContext, limit = 50): Promise<NotificationItem[]> {
	const rows = await ctx.db
		.select({
			id: notification.id,
			type: notification.type,
			commentId: notification.commentId,
			fromStatus: notification.fromStatus,
			toStatus: notification.toStatus,
			fromStatusName: fromStatus.name,
			toStatusName: toStatus.name,
			readAt: notification.readAt,
			createdAt: notification.createdAt,
			actorName: user.name,
			projectKey: project.key,
			issueNumber: issue.number,
			issueTitle: issue.title,
			commentBody: comment.body
		})
		.from(notification)
		.innerJoin(user, eq(user.id, notification.actorId))
		.innerJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, eq(project.id, issue.projectId))
		.leftJoin(comment, eq(comment.id, notification.commentId))
		.leftJoin(
			fromStatus,
			and(eq(fromStatus.projectId, issue.projectId), eq(fromStatus.key, notification.fromStatus))
		)
		.leftJoin(
			toStatus,
			and(eq(toStatus.projectId, issue.projectId), eq(toStatus.key, notification.toStatus))
		)
		.where(mine(ctx))
		.orderBy(desc(notification.createdAt), desc(notification.id))
		.limit(limit);
	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		summary: summaryOf(r),
		actorName: r.actorName,
		projectKey: r.projectKey,
		issueNumber: r.issueNumber,
		issueTitle: r.issueTitle,
		href: hrefOf(r.projectKey, r.issueNumber, r.commentId),
		read: r.readAt !== null,
		createdAt: r.createdAt
	}));
}

export async function countUnread(ctx: AppContext): Promise<number> {
	const [row] = await ctx.db
		.select({ n: count() })
		.from(notification)
		.where(and(mine(ctx), isNull(notification.readAt)));
	return row?.n ?? 0;
}

/** 既読にして遷移先を返す。既読済みでも成功する */
export async function markRead(ctx: AppContext, id: string): Promise<{ href: string }> {
	const [row] = await ctx.db
		.select({ key: project.key, number: issue.number, commentId: notification.commentId })
		.from(notification)
		.innerJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, eq(project.id, issue.projectId))
		.where(and(eq(notification.id, id), mine(ctx)));
	if (!row) throw new AppError('not_found', '通知が見つかりません');
	await ctx.db
		.update(notification)
		.set({ readAt: sql`coalesce(${notification.readAt}, ${Date.now()})` })
		.where(eq(notification.id, id));
	return { href: hrefOf(row.key, row.number, row.commentId) };
}

export async function markAllRead(ctx: AppContext): Promise<void> {
	await ctx.db
		.update(notification)
		.set({ readAt: new Date() })
		.where(and(eq(notification.userId, ctx.actor.id), isNull(notification.readAt)));
}

/** 課題詳細を開いたときに呼ぶ。課題に参加していなければ not_found（getIssue と同じ） */
export async function markIssueRead(ctx: AppContext, key: string, number: number): Promise<void> {
	const { issue: cur } = await getIssue(ctx, key, number);
	await ctx.db
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.userId, ctx.actor.id),
				eq(notification.issueId, cur.id),
				isNull(notification.readAt)
			)
		);
}
