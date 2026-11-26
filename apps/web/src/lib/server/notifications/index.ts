import { and, eq, isNull } from 'drizzle-orm';
import { inList, insertChunks } from '../db/limits';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '#lib/mentions.ts';
import type { Priority, StatusDef } from '#lib/labels.ts';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification, user, userIntegration } from '../db/schema';
import type { MailMessage } from '../mailer';
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
import {
	EMAIL_NOTIFICATION_TYPES,
	MAX_NOTIFICATION_MAILS,
	NOTIFICATION_MAIL_INTERVAL_MS,
	notificationMail
} from './email';
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
				...(e.assigneeIds.length
					? [{ kind: 'assigned', assigneeIds: e.assigneeIds } as const]
					: []),
				...mentioned(null)
			];
		case 'assignees_added':
			return [{ kind: 'assigned', assigneeIds: e.assigneeIds }];
		case 'status_changed':
			return [{ kind: 'status_changed', from: e.from, to: e.to }];
		case 'commented':
			return [{ kind: 'commented', commentId: e.commentId }, ...mentioned(e.commentId)];
		case 'mentions_added':
			return mentioned(e.commentId);
	}
}

/**
 * 受信者の計算と DM に要る事実。起票・更新では書き込みの前に読んだ行から作って notify に渡す（loadFacts の往復を省く）
 */
export interface NotifyFacts {
	participants: { reporterId: string; assigneeIds: string[]; commenterIds: string[] };
	/** 通知を受け取れる人（無効化を除く admin + 参加者）の id → 名前 */
	names: Map<string, string>;
	priority: Priority;
	/** プロジェクトのステータス（Slack の DM の表示に使う）。なければ要るときに読む */
	statuses?: StatusDef[];
}

/** 受信者計算と DM に必要な事実を 1 回の往復（並列）で読む */
async function loadFacts(db: DB, input: NotifyInput): Promise<NotifyFacts> {
	const [[cur], commenters, receivers] = await Promise.all([
		db
			.select({
				reporterId: issue.reporterId,
				assigneeIds: issue.assigneeIds,
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
			assigneeIds: cur.assigneeIds,
			commenterIds: commenters.map((c) => c.id)
		},
		/** 通知を受け取れる人（無効化を除く admin + 参加者）。名前の解決にも使う */
		names: new Map(receivers.map((u) => [u.id, u.name])),
		priority: cur.priority
	};
}

/**
 * Slack をオンにしている受信者の連携先（トークン未設定・該当者なしなら null）と、メールで受け取る人
 * （メールの通知をオフにした人・無効化された人を除く）のアドレス。両方要るときも 1 往復で読む
 */
async function externalTargets(ctx: AppContext, slackUserIds: string[], mailUserIds: string[]) {
	const cfg = channelConfig(ctx, 'slack');
	const [links, mailUsers] = await Promise.all([
		cfg && slackUserIds.length > 0
			? ctx
					.readBatch([
						ctx.db
							.select({ userId: userIntegration.userId, externalId: userIntegration.externalId })
							.from(userIntegration)
							.where(
								and(
									eq(userIntegration.provider, 'slack'),
									inList(userIntegration.userId, slackUserIds)
								)
							)
					])
					.then(([rows]) => rows)
			: [],
		mailUserIds.length > 0
			? ctx
					.readBatch([
						ctx.db
							.select({ id: user.id, email: user.email })
							.from(user)
							.where(
								and(
									inList(user.id, mailUserIds),
									eq(user.emailNotifications, true),
									isNull(user.disabledAt)
								)
							)
					])
					.then(([rows]) => rows)
			: []
	]);
	return { target: cfg && links.length > 0 ? { cfg, links } : null, mailUsers };
}

/** 通知メールをレスポンス後に 1 通ずつ間隔を空けて送る。失敗はログだけ（宛先は userId で残す） */
function sendMailsLater(ctx: AppContext, mails: { userId: string; mail: MailMessage }[]): void {
	if (mails.length === 0) return;
	if (mails.length > MAX_NOTIFICATION_MAILS) {
		console.error(
			`[mail] notification: ${mails.length - MAX_NOTIFICATION_MAILS} mails skipped (over ${MAX_NOTIFICATION_MAILS} per request)`
		);
	}
	ctx.waitUntil(
		(async () => {
			for (const [i, { userId, mail }] of mails.slice(0, MAX_NOTIFICATION_MAILS).entries()) {
				if (i > 0) await new Promise((r) => setTimeout(r, NOTIFICATION_MAIL_INTERVAL_MS));
				try {
					await ctx.mailer.send(mail);
				} catch (e) {
					console.error(`[mail] notification ${userId} failed`, e);
				}
			}
		})()
	);
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

/** Slack をオンにしている受信者に DM を、担当・メンションの受信者にメールを送る。送信はレスポンス後に行う */
async function sendExternal(
	ctx: AppContext,
	input: NotifyInput,
	facts: NotifyFacts,
	planned: PlannedNotification[]
): Promise<void> {
	const { target, mailUsers } = await externalTargets(
		ctx,
		planned.map((n) => n.userId),
		planned.filter((n) => EMAIL_NOTIFICATION_TYPES.has(n.type)).map((n) => n.userId)
	);
	if (!target && mailUsers.length === 0) return;
	// ステータス名は Slack の DM にだけ使う（ステータスの変更はメールで送らない）
	const statuses =
		target && planned.some((n) => n.type === 'status_changed')
			? (facts.statuses ?? (await listStatusesOf(ctx.db, input.project.id)))
			: [];
	const byUser = new Map(planned.map((n) => [n.userId, n]));
	const src: DmSource = {
		baseUrl: ctx.baseUrl,
		projectKey: input.project.key,
		issue: { number: input.issue.number, title: input.issue.title, priority: facts.priority },
		actorName: ctx.actor.name,
		events: input.events,
		statuses
	};
	if (target) {
		for (const l of target.links)
			sendLater(ctx, target.cfg, l, toDirectMessage(src, byUser.get(l.userId)!));
	}
	const accountUrl = `${ctx.baseUrl}/account`;
	sendMailsLater(
		ctx,
		mailUsers.map((u) => ({
			userId: u.id,
			mail: notificationMail(u.email, toDirectMessage(src, byUser.get(u.id)!), accountUrl)
		}))
	);
}

/**
 * 更新が確定した後に呼ぶ。失敗しても元の操作には影響させない。
 * facts を渡せば受信者の計算に要る行を読み直さない（更新後の担当者・優先度で作ること）
 */
export async function notify(
	ctx: AppContext,
	input: NotifyInput,
	known?: NotifyFacts
): Promise<void> {
	try {
		const facts = known ?? (await loadFacts(ctx.db, input));
		const planned = planNotifications({
			actorId: ctx.actor.id,
			participants: facts.participants,
			changes: input.events.flatMap(toChanges),
			canReceive: (id) => facts.names.has(id)
		});
		if (planned.length > 0) {
			const [first, ...rest] = insertChunks(
				notification,
				planned.map((n) => ({
					id: uuidv7(),
					actorId: ctx.actor.id,
					issueId: input.issue.id,
					...n
				}))
			).map((part) => ctx.db.insert(notification).values(part));
			await ctx.db.batch([first, ...rest]);
		}
		await sendExternal(ctx, input, facts, planned);
	} catch (e) {
		console.error('[notify] failed', e);
	}
}

/** まとめ通知の受信者ごとの集計 */
export type BulkType = 'bulk_assigned' | 'bulk_mentioned' | 'bulk_updated';

interface BulkRow {
	userId: string;
	type: BulkType;
	count: number;
}

interface BulkTally {
	assigned: number;
	mentioned: number;
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
				.select({ id: issue.id, reporterId: issue.reporterId, assigneeIds: issue.assigneeIds })
				.from(issue)
				.where(inList(issue.id, ids)),
			ctx.db
				.selectDistinct({ issueId: comment.issueId, id: comment.authorId })
				.from(comment)
				.where(inList(comment.issueId, ids)),
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
					assigneeIds: cur.assigneeIds,
					commenterIds: commenters.filter((c) => c.issueId === cur.id).map((c) => c.id)
				},
				changes: it.events.flatMap(toChanges),
				canReceive: (id) => names.has(id)
			});
			for (const n of planned) {
				const t = tally.get(n.userId) ?? { assigned: 0, mentioned: 0, notified: 0 };
				t.notified++;
				if (n.type === 'assigned') t.assigned++;
				else if (n.type === 'mentioned') t.mentioned++;
				tally.set(n.userId, t);
			}
		}
		if (tally.size === 0) return;
		// 1 件の通知と同じ優先度（担当 > メンション > その他）で理由を 1 つ選ぶ
		const rows: BulkRow[] = [...tally].map(([userId, t]) =>
			t.assigned > 0
				? { userId, type: 'bulk_assigned', count: t.assigned }
				: t.mentioned > 0
					? { userId, type: 'bulk_mentioned', count: t.mentioned }
					: { userId, type: 'bulk_updated', count: t.notified }
		);
		const [first, ...rest] = insertChunks(
			notification,
			rows.map((r) => ({
				id: uuidv7(),
				actorId: ctx.actor.id,
				projectId: input.project.id,
				...r
			}))
		).map((part) => ctx.db.insert(notification).values(part));
		await ctx.db.batch([first, ...rest]);
		await sendBulkExternal(ctx, input.project, rows);
	} catch (e) {
		console.error('[notify] bulk failed', e);
	}
}

async function sendBulkExternal(
	ctx: AppContext,
	project: BulkNotifyInput['project'],
	rows: BulkRow[]
): Promise<void> {
	const { target, mailUsers } = await externalTargets(
		ctx,
		rows.map((r) => r.userId),
		rows.filter((r) => EMAIL_NOTIFICATION_TYPES.has(r.type)).map((r) => r.userId)
	);
	const byUser = new Map(rows.map((r) => [r.userId, r]));
	const src = { baseUrl: ctx.baseUrl, project, actorName: ctx.actor.name };
	if (target) {
		for (const l of target.links)
			sendLater(ctx, target.cfg, l, bulkDirectMessage(src, byUser.get(l.userId)!));
	}
	const accountUrl = `${ctx.baseUrl}/account`;
	sendMailsLater(
		ctx,
		mailUsers.map((u) => ({
			userId: u.id,
			mail: notificationMail(u.email, bulkDirectMessage(src, byUser.get(u.id)!), accountUrl)
		}))
	);
}
