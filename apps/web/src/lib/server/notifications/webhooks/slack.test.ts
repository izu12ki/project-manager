import { describe, expect, it } from 'vitest';
import type { WebhookEvent } from '../events';
import { slack } from './slack';

const base: Omit<WebhookEvent, 'detail'> = {
	project: { key: 'ACME', name: 'Acme' },
	issue: { number: 12, title: 'ログイン画面', url: 'http://pm.example/projects/ACME/issues/12' },
	actor: { name: '平野' }
};
const textOf = (body: unknown) => JSON.stringify(body);
type Block = { type: string; text?: { text: string }; elements?: { text: string }[] };
const blocks = (body: unknown) => (body as { blocks: Block[] }).blocks;

describe('slack.build', () => {
	it('作成: 文面・課題リンク・優先度と担当者', () => {
		const body = slack.build({
			...base,
			detail: { kind: 'issue_created', assignee: '田中', priority: 'high' }
		});
		expect(body).toMatchSnapshot();
		expect(blocks(body)[0].text!.text).toBe(
			'平野さんが 課題を作成 しました。\n*<http://pm.example/projects/ACME/issues/12|ACME-12 ログイン画面>*'
		);
		expect(blocks(body)[1].elements![0].text).toBe('優先度: 高 ・ 担当者: 田中');
	});
	it('担当の変更と解除', () => {
		const set = slack.build({ ...base, detail: { kind: 'assignee_changed', assignee: '田中' } });
		expect(blocks(set)[0].text!.text).toMatch(/^平野さんが 担当者を田中さんに変更 しました。/);
		expect(blocks(set)).toHaveLength(1);
		const unset = slack.build({ ...base, detail: { kind: 'assignee_changed', assignee: null } });
		expect(blocks(unset)[0].text!.text).toMatch(/^平野さんが 担当者を解除 しました。/);
	});
	it('ステータス: context に 未着手 → 進行中', () => {
		const body = slack.build({
			...base,
			detail: { kind: 'status_changed', from: 'todo', to: 'in_progress' }
		});
		expect(blocks(body)[0].text!.text).toMatch(/^平野さんが ステータスを変更 しました。/);
		expect(blocks(body)[1].elements![0].text).toBe('未着手 → 進行中');
	});
	it('コメント: context に抜粋。空なら context なし', () => {
		const body = slack.build({ ...base, detail: { kind: 'commented', excerpt: '確認しました' } });
		expect(blocks(body)[0].text!.text).toMatch(/^平野さんが コメント しました。/);
		expect(blocks(body)[1].elements![0].text).toBe('確認しました');
		expect(
			blocks(slack.build({ ...base, detail: { kind: 'commented', excerpt: '' } }))
		).toHaveLength(1);
	});
	it('メンション追加: 名前を さん付けで並べる。0 人なら送らない', () => {
		const body = slack.build({
			...base,
			detail: { kind: 'mentions_added', where: 'comment', mentioned: ['田中', '佐藤'] }
		});
		expect(blocks(body)[0].text!.text).toMatch(
			/^平野さんが 田中さん、佐藤さんを メンション しました。/
		);
		expect(blocks(body)[1].elements![0].text).toBe('コメント');
		expect(
			slack.build({
				...base,
				detail: { kind: 'mentions_added', where: 'description', mentioned: [] }
			})
		).toBeNull();
	});
	it('ユーザー入力の & < > をエスケープし、<!channel> や <@U1> を効かせない', () => {
		const body = slack.build({
			...base,
			actor: { name: '<@U1>' },
			issue: { ...base.issue, title: '<!channel> A&B' },
			detail: { kind: 'commented', excerpt: '<!here>' }
		});
		const s = textOf(body);
		expect(s).not.toContain('<!channel>');
		expect(s).not.toContain('<!here>');
		expect(s).not.toContain('<@U1>');
		expect(s).toContain('&lt;!channel&gt; A&amp;B');
	});
	it('通知欄用の text を持つ', () => {
		const body = slack.build({ ...base, detail: { kind: 'commented', excerpt: 'x' } }) as {
			text: string;
		};
		expect(body.text).toBe('平野さんが コメント しました。 ACME-12 ログイン画面');
	});
	it('URL パターン', () => {
		expect(slack.urlPattern.test('https://hooks.slack.com/services/T0/B0/abc_DEF-1')).toBe(true);
		expect(slack.urlPattern.test('http://hooks.slack.com/services/T0/B0/x')).toBe(false);
		expect(slack.urlPattern.test('https://hooks.slack.com.evil.example/services/x')).toBe(false);
		expect(slack.urlPattern.test('https://example.com/services/x')).toBe(false);
	});
});
