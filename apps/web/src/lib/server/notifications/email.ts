import type { NotificationType } from '../db/schema';
import type { MailMessage } from '../mailer';
import { headline } from './channels/message';
import type { DirectMessage } from './channels/types';

/**
 * メールでも知らせる通知。担当者に設定されたときと、メンションされたとき（Backlog の「お知らせしたいユーザー」にあたる）。
 * コメントやステータスの変更まで送ると、メール送信サービスの無料枠（1 日 100〜200 通）をすぐ使い切るため送らない
 */
export const EMAIL_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
	'assigned',
	'mentioned',
	'bulk_assigned',
	'bulk_mentioned'
]);

/** 1 回のリクエストで送る通知メールの上限。Workers の無料プランでは外部への通信が 1 リクエスト 50 回まで */
export const MAX_NOTIFICATION_MAILS = 40;

/** 通知メールを続けて送る間隔。メール送信サービスの上限（Resend は 1 秒に 10 回）を超えないようにする */
export const NOTIFICATION_MAIL_INTERVAL_MS = 120;

/** 通知 1 件のメール。件名は Backlog と同じく「[課題キー] 件名」 */
export function notificationMail(to: string, m: DirectMessage, accountUrl: string): MailMessage {
	const single = m.count === undefined;
	return {
		to,
		subject: single ? `[${m.issue.key}] ${m.issue.title}` : `[${m.issue.key}] ${headline(m)}`,
		text: [
			headline(m),
			'',
			single ? `${m.issue.key} ${m.issue.title}` : m.issue.title,
			...(m.detail ? [m.detail] : []),
			m.issue.url,
			'',
			'---',
			'担当者に設定されたときと、メンションされたときにメールで知らせています。',
			`メールでの通知はアカウント設定で止められます: ${accountUrl}`
		].join('\n')
	};
}
