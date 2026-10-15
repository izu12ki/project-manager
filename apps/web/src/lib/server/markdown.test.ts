import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

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
});
