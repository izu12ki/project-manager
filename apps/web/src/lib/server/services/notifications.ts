import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { statusName } from '#lib/labels.ts';
import { can } from '../authz';
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
import { bulkPath } from '../notifications/channels';
import { excerpt } from '../notifications/format';
import { getIssue } from './issues';

export interface NotificationItem {
	id: string;
	type: NotificationType;
	summary: string;
	actorName: string;
	projectKey: string;
	/** まとめ通知では null */
	issueNumber: number | null;
	issueTitle: string | null;
	/** まとめ通知の課題数。課題ごとの通知では null */
	count: number | null;
	href: string;
	read: boolean;
	createdAt: Date;
}

/** 自分宛てで、今もアクセスできるプロジェクトの通知（課題ごとの通知は課題、まとめ通知はプロジェクトで判定） */
function mine(ctx: AppContext): SQL {
	const own = eq(notification.userId, ctx.actor.id);
	if (ctx.actor.role === 'admin') return own;
	const joined = ctx.db
		.select({ id: projectMember.projectId })
		.from(projectMember)
		.where(eq(projectMember.userId, ctx.actor.id));
	return and(
		own,
		or(
			inArray(
				notification.issueId,
				ctx.db.select({ id: issue.id }).from(issue).where(inArray(issue.projectId, joined))
			),
			inArray(notification.projectId, joined)
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
	count: number | null;
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
		case 'bulk_assigned':
			return `${r.count} 件の課題であなたを担当者に設定しました`;
		case 'bulk_mentioned':
			return `${r.count} 件の課題であなたをメンションしました`;
		case 'bulk_updated':
			return `${r.count} 件の課題を更新しました`;
	}
}

const fromStatus = alias(issueStatus, 'from_status');
const toStatus = alias(issueStatus, 'to_status');

function hrefOf(
	ctx: AppContext,
	r: { type: NotificationType; key: string; number: number | null; commentId: string | null }
): string {
	if (r.type === 'bulk_assigned' || r.type === 'bulk_mentioned' || r.type === 'bulk_updated')
		return bulkPath(r.key, r.type, ctx.actor.id);
	return `/projects/${r.key}/issues/${r.number}${r.commentId ? `#comment-${r.commentId}` : ''}`;
}

/** まとめ通知は notification.project_id、課題ごとの通知は課題のプロジェクト */
const projectJoin = eq(project.id, sql`coalesce(${notification.projectId}, ${issue.projectId})`);

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
			count: notification.count,
			commentBody: comment.body
		})
		.from(notification)
		.innerJoin(user, eq(user.id, notification.actorId))
		.leftJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, projectJoin)
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
		count: r.count,
		href: hrefOf(ctx, {
			type: r.type,
			key: r.projectKey,
			number: r.issueNumber,
			commentId: r.commentId
		}),
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
		.select({
			type: notification.type,
			key: project.key,
			number: issue.number,
			commentId: notification.commentId
		})
		.from(notification)
		.leftJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, projectJoin)
		.where(and(eq(notification.id, id), mine(ctx)));
	if (!row) throw new AppError('not_found', '通知が見つかりません');
	if (can(ctx.actor, 'notification:read'))
		await ctx.db
			.update(notification)
			.set({ readAt: sql`coalesce(${notification.readAt}, ${Date.now()})` })
			.where(eq(notification.id, id));
	return { href: hrefOf(ctx, row) };
}

export async function markAllRead(ctx: AppContext): Promise<void> {
	if (!can(ctx.actor, 'notification:read')) return;
	await ctx.db
		.update(notification)
		.set({ readAt: new Date() })
		.where(and(eq(notification.userId, ctx.actor.id), isNull(notification.readAt)));
}

/** 課題詳細を開いたときに呼ぶ。課題に参加していなければ not_found（getIssue と同じ） */
export async function markIssueRead(ctx: AppContext, key: string, number: number): Promise<void> {
	const { issue: cur } = await getIssue(ctx, key, number);
	if (!can(ctx.actor, 'notification:read')) return;
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
