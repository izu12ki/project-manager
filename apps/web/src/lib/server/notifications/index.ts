import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '$lib/mentions';
import type { Priority } from '$lib/labels';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification, userIntegration } from '../db/schema';
import { listStatusesOf } from '../services/issue-fields';
import { listAssignableUsers } from '../services/projects';
import {
	bulkDirectMessage,
	channelConfig,
	providers,
	toDirectMessage,
	type ChannelConfig,
	type DirectMessage,
	type DmSource
} from './channels';
import type { BulkNotifyInput, IssueEvent, NotifyInput } from './events';
import { planNotifications, type Change, type PlannedNotification } from './recipients';

export type { BulkNotifyInput, IssueEvent, NotifyInput } from './events';

/** イベントでメンションが増えた人（受信可否で絞る前） */
export function addedMentions(e: IssueEvent): string[] {
	switch (e.kind) {
		case 'issue_created':
			return extractMentionIds(e.description);
		case 'commented':
			return extractMentionIds(e.body);
		case 'mentions_added': {
			const before = new Set(extractMentionIds(e.before));
			return extractMentionIds(e.after).filter((id) => !before.has(id));
		}
		default:
			return [];
	}
}

function toChanges(e: IssueEvent): Change[] {
	const mentioned = (commentId: string | null): Change[] => {
		const userIds = addedMentions(e);
		return userIds.length ? [{ kind: 'mentioned', userIds, commentId }] : [];
	};
	switch (e.kind) {
		case 'issue_created':
			return [
				...(e.assigneeId ? [{ kind: 'assigned', assigneeId: e.assigneeId } as const] : []),
				...mentioned(null)
			];
		case 'assignee_changed':
			return e.assigneeId ? [{ kind: 'assigned', assigneeId: e.assigneeId }] : [];
		case 'status_changed':
			return [{ kind: 'status_changed', from: e.from, to: e.to }];
		case 'commented':
			return [{ kind: 'commented', commentId: e.commentId }, ...mentioned(e.commentId)];
		case 'mentions_added':
			return mentioned(e.commentId);
	}
}

/** 受信者計算と DM に必要な事実を 1 回の往復（並列）で読む */
async function loadFacts(db: DB, input: NotifyInput) {
	const [[cur], commenters, receivers] = await Promise.all([
		db
			.select({
				reporterId: issue.reporterId,
				assigneeId: issue.assigneeId,
				priority: issue.priority
			})
			.from(issue)
			.where(eq(issue.id, input.issue.id)),
		db
			.selectDistinct({ id: comment.authorId })
			.from(comment)
			.where(eq(comment.issueId, input.issue.id)),
		listAssignableUsers(db, input.project.id)
	]);
	return {
		participants: {
			reporterId: cur.reporterId,
			assigneeId: cur.assigneeId,
			commenterIds: commenters.map((c) => c.id)
		},
		/** 通知を受け取れる人（無効化を除く admin + 参加者）。名前の解決にも使う */
		names: new Map(receivers.map((u) => [u.id, u.name])),
		priority: cur.priority
	};
}

/** Slack をオンにしている受信者の連携先。トークン未設定・該当者なしなら null */
async function slackLinks(ctx: AppContext, userIds: string[]) {
	const cfg = channelConfig(ctx, 'slack');
	if (!cfg || userIds.length === 0) return null;
	const links = await ctx.db
		.select({ userId: userIntegration.userId, externalId: userIntegration.externalId })
		.from(userIntegration)
		.where(and(eq(userIntegration.provider, 'slack'), inArray(userIntegration.userId, userIds)));
	return links.length > 0 ? { cfg, links } : null;
}

/** 1 通をレスポンス後に送る。失敗はログだけ */
function sendLater(
	ctx: AppContext,
	cfg: ChannelConfig,
	link: { userId: string; externalId: string },
	m: DirectMessage
): void {
	ctx.waitUntil(
		providers.slack.send(cfg, link.externalId, m).then((r) => {
			if (!r.ok) console.error(`[dm] slack ${link.userId}: ${r.error}`);
		})
	);
}

/** オンにしている受信者に DM を送る。送信はレスポンス後に行う */
async function sendDirectMessages(
	ctx: AppContext,
	input: NotifyInput,
	priority: Priority,
	planned: PlannedNotification[]
): Promise<void> {
	const target = await slackLinks(
		ctx,
		planned.map((n) => n.userId)
	);
	if (!target) return;
	const statuses = planned.some((n) => n.type === 'status_changed')
		? await listStatusesOf(ctx.db, input.project.id)
		: [];
	const byUser = new Map(planned.map((n) => [n.userId, n]));
	const src: DmSource = {
		baseUrl: ctx.baseUrl,
		projectKey: input.project.key,
		issue: { number: input.issue.number, title: input.issue.title, priority },
		actorName: ctx.actor.name,
		events: input.events,
		statuses
	};
	for (const l of target.links)
		sendLater(ctx, target.cfg, l, toDirectMessage(src, byUser.get(l.userId)!));
}

/** 更新が確定した後に呼ぶ。失敗しても元の操作には影響させない */
export async function notify(ctx: AppContext, input: NotifyInput): Promise<void> {
	try {
		const facts = await loadFacts(ctx.db, input);
		const planned = planNotifications({
			actorId: ctx.actor.id,
			participants: facts.participants,
			changes: input.events.flatMap(toChanges),
			canReceive: (id) => facts.names.has(id)
		});
		if (planned.length > 0) {
			await ctx.db.insert(notification).values(
				planned.map((n) => ({
					id: uuidv7(),
					actorId: ctx.actor.id,
					issueId: input.issue.id,
					...n
				}))
			);
		}
		await sendDirectMessages(ctx, input, facts.priority, planned);
	} catch (e) {
		console.error('[notify] failed', e);
	}
}

/** まとめ通知の受信者ごとの集計 */
interface BulkTally {
	assigned: number;
	notified: number;
}

/**
 * 一括 API の更新が確定した後に呼ぶ。課題ごとに planNotifications を適用し、
 * 受信者ごとに 1 件のまとめ通知（アプリ内 + Slack DM）にする。失敗しても元の操作には影響させない
 */
export async function notifyBulk(ctx: AppContext, input: BulkNotifyInput): Promise<void> {
	try {
		const items = input.items.filter((it) => it.events.length > 0);
		if (items.length === 0) return;
		const ids = items.map((it) => it.issue.id);
		const [issues, commenters, receivers] = await Promise.all([
			ctx.db
				.select({ id: issue.id, reporterId: issue.reporterId, assigneeId: issue.assigneeId })
				.from(issue)
				.where(inArray(issue.id, ids)),
			ctx.db
				.selectDistinct({ issueId: comment.issueId, id: comment.authorId })
				.from(comment)
				.where(inArray(comment.issueId, ids)),
			listAssignableUsers(ctx.db, input.project.id)
		]);
		const names = new Set(receivers.map((u) => u.id));
		const byIssue = new Map(issues.map((i) => [i.id, i]));
		const tally = new Map<string, BulkTally>();
		for (const it of items) {
			const cur = byIssue.get(it.issue.id);
			if (!cur) continue;
			const planned = planNotifications({
				actorId: ctx.actor.id,
				participants: {
					reporterId: cur.reporterId,
					assigneeId: cur.assigneeId,
					commenterIds: commenters.filter((c) => c.issueId === cur.id).map((c) => c.id)
				},
				changes: it.events.flatMap(toChanges),
				canReceive: (id) => names.has(id)
			});
			for (const n of planned) {
				const t = tally.get(n.userId) ?? { assigned: 0, notified: 0 };
				t.notified++;
				if (n.type === 'assigned') t.assigned++;
				tally.set(n.userId, t);
			}
		}
		if (tally.size === 0) return;
		const rows = [...tally].map(([userId, t]) => ({
			userId,
			type: t.assigned > 0 ? ('bulk_assigned' as const) : ('bulk_updated' as const),
			count: t.assigned > 0 ? t.assigned : t.notified
		}));
		await ctx.db.insert(notification).values(
			rows.map((r) => ({
				id: uuidv7(),
				actorId: ctx.actor.id,
				projectId: input.project.id,
				...r
			}))
		);
		await sendBulkDirectMessages(ctx, input.project, rows);
	} catch (e) {
		console.error('[notify] bulk failed', e);
	}
}

async function sendBulkDirectMessages(
	ctx: AppContext,
	project: BulkNotifyInput['project'],
	rows: { userId: string; type: 'bulk_assigned' | 'bulk_updated'; count: number }[]
): Promise<void> {
	const target = await slackLinks(
		ctx,
		rows.map((r) => r.userId)
	);
	if (!target) return;
	const byUser = new Map(rows.map((r) => [r.userId, r]));
	const src = { baseUrl: ctx.baseUrl, project, actorName: ctx.actor.name };
	for (const l of target.links)
		sendLater(ctx, target.cfg, l, bulkDirectMessage(src, byUser.get(l.userId)!));
}
