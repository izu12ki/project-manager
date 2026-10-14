import { PRIORITY_LABEL, STATUS_LABEL } from '$lib/labels';
import type { WebhookEvent } from '../events';
import type { WebhookProvider } from './types';

/** Slack の mrkdwn で制御文字になる & < > をエスケープする（<!channel> などを無効にする） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function headline(e: WebhookEvent): string {
	const who = `${e.actor.name}さんが`;
	const d = e.detail;
	switch (d.kind) {
		case 'issue_created':
			return `${who} 課題を作成 しました。`;
		case 'assignee_changed':
			return d.assignee
				? `${who} 担当者を${d.assignee}さんに変更 しました。`
				: `${who} 担当者を解除 しました。`;
		case 'status_changed':
			return `${who} ステータスを変更 しました。`;
		case 'commented':
			return `${who} コメント しました。`;
		case 'mentions_added':
			return `${who} ${d.mentioned.map((n) => `${n}さん`).join('、')}を メンション しました。`;
	}
}

function context(e: WebhookEvent): string {
	const d = e.detail;
	switch (d.kind) {
		case 'issue_created':
			return `優先度: ${PRIORITY_LABEL[d.priority]} ・ 担当者: ${d.assignee ?? '未設定'}`;
		case 'assignee_changed':
			return '';
		case 'status_changed':
			return `${STATUS_LABEL[d.from]} → ${STATUS_LABEL[d.to]}`;
		case 'commented':
			return d.excerpt;
		case 'mentions_added':
			return d.where === 'comment' ? 'コメント' : '説明';
	}
}

function message(head: string, link: string | null, ctx: string) {
	const ref = link ? `\n${link}` : '';
	return {
		blocks: [
			{ type: 'section', text: { type: 'mrkdwn', text: `${esc(head)}${ref}` } },
			...(ctx ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: esc(ctx) }] }] : [])
		]
	};
}

export const slack: WebhookProvider = {
	id: 'slack',
	label: 'Slack',
	urlPattern: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/,
	build(e) {
		if (e.detail.kind === 'mentions_added' && e.detail.mentioned.length === 0) return null;
		const head = headline(e);
		const ref = `${e.project.key}-${e.issue.number} ${e.issue.title}`;
		return {
			text: esc(`${head} ${ref}`),
			...message(head, `*<${e.issue.url}|${esc(ref)}>*`, context(e))
		};
	},
	buildTest(project) {
		const head = `プロジェクト「${project.name}」の通知がこのチャンネルに届きます（テスト送信）`;
		return { text: esc(head), ...message(head, null, '') };
	}
};
