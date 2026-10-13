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
});
