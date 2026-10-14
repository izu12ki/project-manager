import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '$lib/mentions';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification, projectWebhook } from '../db/schema';
import { listAssignableUsers } from '../services/projects';
import type { IssueEvent, NotifyInput, WebhookEvent } from './events';
import { excerpt } from './format';
import { planNotifications, type Change } from './recipients';
import { deliver, providers } from './webhooks';

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
	const [[cur], commenters, receivers, hooks] = await Promise.all([
		db
			.select({ reporterId: issue.reporterId, assigneeId: issue.assigneeId })
			.from(issue)
			.where(eq(issue.id, input.issue.id)),
		db
			.selectDistinct({ id: comment.authorId })
			.from(comment)
			.where(eq(comment.issueId, input.issue.id)),
		listAssignableUsers(db, input.project.id),
		db
			.select({ provider: projectWebhook.provider, url: projectWebhook.url })
			.from(projectWebhook)
			.where(eq(projectWebhook.projectId, input.project.id))
	]);
	return {
		participants: {
			reporterId: cur.reporterId,
			assigneeId: cur.assigneeId,
			commenterIds: commenters.map((c) => c.id)
		},
		/** 通知を受け取れる人（無効化を除く admin + 参加者）。名前の解決にも使う */
		names: new Map(receivers.map((u) => [u.id, u.name])),
		hooks
	};
}

function toWebhookEvent(
	ctx: AppContext,
	input: NotifyInput,
	names: Map<string, string>,
	e: IssueEvent
): WebhookEvent {
	const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
	const shared = {
		project: { key: input.project.key, name: input.project.name },
		issue: {
			number: input.issue.number,
			title: input.issue.title,
			url: `${ctx.baseUrl}/projects/${input.project.key}/issues/${input.issue.number}`
		},
		actor: { name: ctx.actor.name }
	};
	switch (e.kind) {
		case 'issue_created':
			return {
				...shared,
				detail: { kind: e.kind, assignee: name(e.assigneeId), priority: e.priority }
			};
		case 'assignee_changed':
			return { ...shared, detail: { kind: e.kind, assignee: name(e.assigneeId) } };
		case 'status_changed':
			return { ...shared, detail: { kind: e.kind, from: e.from, to: e.to } };
		case 'commented':
			return { ...shared, detail: { kind: e.kind, excerpt: excerpt(e.body, 200) } };
		case 'mentions_added':
			return {
				...shared,
				detail: {
					kind: e.kind,
					where: e.commentId ? 'comment' : 'description',
					// 通知と同じく、受信できる人・本人以外だけを並べる
					mentioned: addedMentions(e)
						.filter((id) => id !== ctx.actor.id && names.has(id))
						.map((id) => names.get(id)!)
				}
			};
	}
}

function sendWebhooks(
	ctx: AppContext,
	input: NotifyInput,
	facts: Awaited<ReturnType<typeof loadFacts>>
): void {
	for (const hook of facts.hooks) {
		const provider = providers[hook.provider];
		const bodies = input.events
			.map((e) => provider.build(toWebhookEvent(ctx, input, facts.names, e)))
			.filter((b) => b !== null);
		if (bodies.length === 0) continue;
		// 同じ送信先には出来事の順に 1 件ずつ送る
		ctx.waitUntil(
			(async () => {
				for (const body of bodies) {
					const r = await deliver(ctx.fetch, hook.url, body);
					if (!r.ok) console.error(`[webhook] ${hook.provider} ${input.project.key}: ${r.error}`);
				}
			})()
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
		sendWebhooks(ctx, input, facts);
	} catch (e) {
		console.error('[notify] failed', e);
	}
}
