import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { renderMarkdown } from './markdown';

const legacy = new MarkdownIt({ html: false, linkify: true, breaks: true });
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('renderMarkdown', () => {
	it('生の HTML はエスケープする', () => {
		const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
	});
	it('javascript: リンクはリンクにしない', () => {
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript:');
	});
	it('リンクには rel と target を付ける', () => {
		const html = renderMarkdown('[x](https://example.com)');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
		expect(html).toContain('target="_blank"');
	});
	it('URL を自動リンクする', () => {
		expect(renderMarkdown('see https://example.com')).toContain('<a href="https://example.com"');
	});
	it('画像は拡大表示用の .md-img で包む', () => {
		expect(renderMarkdown('![shot](/a.png)')).toContain(
			'<span class="md-img"><img src="/a.png" alt="shot"></span>'
		);
	});
	it('メンションはバッジにし、リンクにしない', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		const html = renderMarkdown(`hi @[田中 太郎](user:${id}) さん`);
		expect(html).toContain('<span class="mention">@田中 太郎</span>');
		expect(html).not.toContain('user:');
	});
	it('メンションの表示名はエスケープする', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(renderMarkdown(`@[<b>x</b>](user:${id})`)).toContain('@&lt;b&gt;x&lt;/b&gt;');
	});
	it('コード内のメンション記法はそのまま表示する', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(renderMarkdown('`@[a](user:' + id + ')`')).not.toContain('class="mention"');
	});

	it('打ち消し線', () => expect(renderMarkdown('~~x~~')).toContain('<del>x</del>'));
	it('チェックリスト', () => {
		const html = renderMarkdown('- [ ] a\n- [x] b');
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
		expect(html).toMatch(/<input[^>]*checked/);
	});
	it('ネストした箇条書き', () =>
		expect(renderMarkdown('- a\n  - b')).toMatch(/<li>a\s*<ul>\s*<li>b<\/li>/));
	it('段落内の 1 回の改行は <br>', () => expect(renderMarkdown('a\nb')).toMatch(/a<br>\s*b/));
	it('表', () => expect(renderMarkdown('| a |\n| - |\n| b |')).toContain('<table>'));
	it('mailto と相対 URL はリンクにする', () => {
		expect(renderMarkdown('[m](mailto:a@example.com)')).toContain('href="mailto:a@example.com"');
		expect(renderMarkdown('[f](/projects/A/attachments/1)')).toContain(
			'href="/projects/A/attachments/1"'
		);
	});
	it('許可しないプロトコルの画像は出さない', () =>
		expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('javascript:'));
	it.each([
		'see example.com',
		'詳細はhttps://example.com/です',
		'https://example.com/a?b=1。',
		'(https://example.com)',
		'mail a@example.com'
	])('自動リンクは markdown-it と同じ: %s', (src) => {
		expect(hrefs(renderMarkdown(src))).toEqual(hrefs(legacy.render(src)));
	});
});
