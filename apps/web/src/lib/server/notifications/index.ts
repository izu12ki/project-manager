import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '$lib/mentions';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification } from '../db/schema';
import { listAssignableUsers } from '../services/projects';
import type { IssueEvent, NotifyInput } from './events';
import { planNotifications, type Change } from './recipients';

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

/** 受信者計算と Webhook に必要な事実を 1 回の往復（並列）で読む */
async function loadFacts(db: DB, input: NotifyInput) {
	const [[cur], commenters, receivers] = await Promise.all([
		db
			.select({ reporterId: issue.reporterId, assigneeId: issue.assigneeId })
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
		names: new Map(receivers.map((u) => [u.id, u.name]))
	};
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
	} catch (e) {
		console.error('[notify] failed', e);
	}
}
