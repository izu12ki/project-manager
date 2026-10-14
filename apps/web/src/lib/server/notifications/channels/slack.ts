import { headline } from './message';
import type { ChannelConfig, DirectMessage, SendResult, UserChannelProvider } from './types';

const API = 'https://slack.com/api/';

/** Slack の mrkdwn で制御文字になる & < > をエスケープする（<!channel> やリンク偽装を無効にする） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type SlackResponse = { ok: boolean; error?: string; user?: { id: string } };

/** Web API を呼ぶ。HTTP エラー・タイムアウト・例外は ok: false にする */
async function call(cfg: ChannelConfig, path: string, body?: unknown): Promise<SlackResponse> {
	try {
		const res = await cfg.fetch(API + path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				Authorization: `Bearer ${cfg.token}`,
				...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' })
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		return (await res.json()) as SlackResponse;
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError')
			return { ok: false, error: 'タイムアウト' };
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export function buildSlackDm(m: DirectMessage) {
	const head = headline(m);
	const ref = `${m.issue.key} ${m.issue.title}`;
	return {
		text: esc(`${head} ${ref}`),
		blocks: [
			{
				type: 'section',
				text: { type: 'mrkdwn', text: `${esc(head)}\n*<${m.issue.url}|${esc(ref)}>*` }
			},
			...(m.detail
				? [{ type: 'context', elements: [{ type: 'mrkdwn', text: esc(m.detail) }] }]
				: [])
		]
	};
}

async function post(cfg: ChannelConfig, channel: string, payload: object): Promise<SendResult> {
	const r = await call(cfg, 'chat.postMessage', { channel, ...payload });
	return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'unknown' };
}

export const slack: UserChannelProvider = {
	id: 'slack',
	label: 'Slack',
	async lookup(cfg, email) {
		const r = await call(cfg, `users.lookupByEmail?email=${encodeURIComponent(email)}`);
		if (r.ok && r.user) return { ok: true, externalId: r.user.id };
		const error = r.error ?? 'unknown';
		return { ok: false, reason: error === 'users_not_found' ? 'not_found' : 'config', error };
	},
	send: (cfg, externalId, m) => post(cfg, externalId, buildSlackDm(m)),
	sendWelcome: (cfg, externalId) =>
		post(cfg, externalId, { text: 'プロジェクト管理の通知をここで受け取ります。' })
};
