import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '$lib/mentions';
import type { Priority } from '$lib/labels';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification, userIntegration } from '../db/schema';
import { listStatusesOf } from '../services/issue-fields';
import { listAssignableUsers } from '../services/projects';
import { channelConfig, providers, toDirectMessage, type DmSource } from './channels';
import type { IssueEvent, NotifyInput } from './events';
import { planNotifications, type Change, type PlannedNotification } from './recipients';

export type { IssueEvent, NotifyInput } from './events';

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

/** オンにしている受信者に DM を送る。送信はレスポンス後に行う */
async function sendDirectMessages(
	ctx: AppContext,
	input: NotifyInput,
	priority: Priority,
	planned: PlannedNotification[]
): Promise<void> {
	const cfg = channelConfig(ctx, 'slack');
	if (!cfg || planned.length === 0) return;
	const links = await ctx.db
		.select({ userId: userIntegration.userId, externalId: userIntegration.externalId })
		.from(userIntegration)
		.where(
			and(
				eq(userIntegration.provider, 'slack'),
				inArray(
					userIntegration.userId,
					planned.map((n) => n.userId)
				)
			)
		);
	if (links.length === 0) return;
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
	for (const l of links) {
		const m = toDirectMessage(src, byUser.get(l.userId)!);
		ctx.waitUntil(
			providers.slack.send(cfg, l.externalId, m).then((r) => {
				if (!r.ok) console.error(`[dm] slack ${l.userId}: ${r.error}`);
			})
		);
	}
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
