import { describe, expect, it } from 'vitest';
import { mentionToken } from '$lib/mentions';
import { excerpt } from './format';

describe('excerpt', () => {
	it('Markdown 記号を除き、空白を詰める', () => {
		expect(excerpt('# 見出し\n\n- **太字** と `code`\n> 引用 [リンク](https://x)', 200)).toBe(
			'見出し 太字 と code 引用 リンク'
		);
	});
	it('画像は alt、メンションは @名前 にする', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(excerpt(`![画面](/a.png) ${mentionToken({ id, name: '田中' })}`, 200)).toBe(
			'画面 @田中'
		);
	});
	it('max 文字を超えたら切って … を付ける（サロゲートペアを壊さない）', () => {
		expect(excerpt('あいうえお', 3)).toBe('あいう…');
		expect(excerpt('😀😀😀', 2)).toBe('😀😀…');
		expect(excerpt('abc', 3)).toBe('abc');
	});
});
