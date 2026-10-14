import { describe, expect, it } from 'vitest';
import { buildSlackDm, slack } from './slack';
import type { ChannelConfig, DirectMessage } from './types';

function cfgReturning(body: unknown, status = 200) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const cfg: ChannelConfig = {
		token: 'xoxb-t',
		fetch: async (input, init) => {
			calls.push({ url: String(input), init });
			return new Response(JSON.stringify(body), { status });
		}
	};
	return { cfg, calls };
}

const m: DirectMessage = {
	type: 'commented',
	actor: { name: '花子' },
	issue: {
		key: 'ACME-1',
		title: 'A <!channel>',
		url: 'http://x/projects/ACME/issues/1#comment-c1'
	},
	detail: '<https://evil|x> & y'
};

describe('slack.lookup', () => {
	it('見つかればユーザー ID。メールは URL エンコードし、Bearer で送る', async () => {
		const { cfg, calls } = cfgReturning({ ok: true, user: { id: 'U123' } });
		expect(await slack.lookup(cfg, 'a+b@example.com')).toEqual({ ok: true, externalId: 'U123' });
		expect(calls[0].url).toBe(
			'https://slack.com/api/users.lookupByEmail?email=a%2Bb%40example.com'
		);
		expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer xoxb-t');
	});

	it('users_not_found は not_found', async () => {
		const { cfg } = cfgReturning({ ok: false, error: 'users_not_found' });
		expect(await slack.lookup(cfg, 'a@example.com')).toEqual({
			ok: false,
			reason: 'not_found',
			error: 'users_not_found'
		});
	});

	it('invalid_auth や HTTP エラー・例外は config', async () => {
		expect(
			await slack.lookup(cfgReturning({ ok: false, error: 'invalid_auth' }).cfg, 'a@x')
		).toEqual({ ok: false, reason: 'config', error: 'invalid_auth' });
		expect(await slack.lookup(cfgReturning({}, 500).cfg, 'a@x')).toEqual({
			ok: false,
			reason: 'config',
			error: 'HTTP 500'
		});
		const throwing: ChannelConfig = {
			token: 't',
			fetch: async () => {
				throw new Error('network down');
			}
		};
		expect(await slack.lookup(throwing, 'a@x')).toEqual({
			ok: false,
			reason: 'config',
			error: 'network down'
		});
	});
});

describe('slack.send', () => {
	it('chat.postMessage に channel = ユーザー ID で送る', async () => {
		const { cfg, calls } = cfgReturning({ ok: true });
		expect(await slack.send(cfg, 'U123', m)).toEqual({ ok: true });
		expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage');
		expect(calls[0].init?.method).toBe('POST');
		const body = JSON.parse(String(calls[0].init?.body));
		expect(body.channel).toBe('U123');
		expect(body.text).toBe('花子さんが コメント しました。 ACME-1 A &lt;!channel&gt;');
	});

	it('HTTP 200 でも ok: false なら失敗', async () => {
		const { cfg } = cfgReturning({ ok: false, error: 'channel_not_found' });
		expect(await slack.send(cfg, 'U123', m)).toEqual({ ok: false, error: 'channel_not_found' });
	});

	it('確認メッセージ', async () => {
		const { cfg, calls } = cfgReturning({ ok: true });
		expect(await slack.sendWelcome(cfg, 'U123')).toEqual({ ok: true });
		const body = JSON.parse(String(calls[0].init?.body));
		expect(body).toMatchObject({
			channel: 'U123',
			text: 'プロジェクト管理の通知をここで受け取ります。'
		});
	});
});

describe('buildSlackDm', () => {
	it('1 行目＋課題リンク、2 行目は context。< > & はエスケープ', () => {
		expect(buildSlackDm(m).blocks).toEqual([
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '花子さんが コメント しました。\n*<http://x/projects/ACME/issues/1#comment-c1|ACME-1 A &lt;!channel&gt;>*'
				}
			},
			{ type: 'context', elements: [{ type: 'mrkdwn', text: '&lt;https://evil|x&gt; &amp; y' }] }
		]);
	});

	it('detail が空なら context を付けない', () => {
		expect(buildSlackDm({ ...m, detail: '' }).blocks).toHaveLength(1);
	});
});
