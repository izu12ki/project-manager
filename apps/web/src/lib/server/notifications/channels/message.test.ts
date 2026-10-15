import { describe, expect, it } from 'vitest';
import { headline, toDirectMessage, type DmSource } from './message';

const src: DmSource = {
	baseUrl: 'http://x',
	projectKey: 'ACME',
	issue: { number: 12, title: 'ログイン不具合', priority: 'high' },
	actorName: '花子',
	events: [
		{ kind: 'commented', commentId: 'c1', body: '**確認**お願いします' },
		{ kind: 'mentions_added', commentId: null, before: '', after: '説明の本文' }
	]
};
const none = { commentId: null, fromStatus: null, toStatus: null };

describe('toDirectMessage', () => {
	it('assigned は優先度、リンクは課題', () => {
		const m = toDirectMessage(src, { userId: 'u', type: 'assigned', ...none });
		expect(m).toEqual({
			type: 'assigned',
			actor: { name: '花子' },
			issue: { key: 'ACME-12', title: 'ログイン不具合', url: 'http://x/projects/ACME/issues/12' },
			detail: '優先度: 高'
		});
		expect(headline(m)).toBe('花子さんが あなたを担当者に設定 しました。');
	});

	it('commented はコメントの抜粋とコメントへのリンク', () => {
		const m = toDirectMessage(src, { userId: 'u', type: 'commented', ...none, commentId: 'c1' });
		expect(m.detail).toBe('確認お願いします');
		expect(m.issue.url).toBe('http://x/projects/ACME/issues/12#comment-c1');
		expect(headline(m)).toBe('花子さんが コメント しました。');
	});

	it('説明でのメンションは説明の抜粋', () => {
		const m = toDirectMessage(src, { userId: 'u', type: 'mentioned', ...none });
		expect(m.detail).toBe('説明の本文');
		expect(headline(m)).toBe('花子さんが あなたを メンション しました。');
	});

	it('status_changed は変更前後', () => {
		const m = toDirectMessage(src, {
			userId: 'u',
			type: 'status_changed',
			commentId: null,
			fromStatus: 'todo',
			toStatus: 'in_progress'
		});
		expect(m.detail).toBe('未着手 → 進行中');
		expect(headline(m)).toBe('花子さんが ステータスを変更 しました。');
	});

	it('本文が見つからなければ detail は空', () => {
		const m = toDirectMessage(src, { userId: 'u', type: 'commented', ...none, commentId: 'zz' });
		expect(m.detail).toBe('');
	});
});
