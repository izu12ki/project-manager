import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { renderMarkdown } from './markdown';
import { backlogToMarkdown } from '#lib/backlog-notation.ts';

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

	describe('参照形式のリンクと画像', () => {
		it('javascript: のリンクはリンクにしない', () => {
			const html = renderMarkdown('[x][r]\n\n[r]: javascript:alert(1)');
			expect(html).not.toContain('javascript:');
			expect(html).not.toContain('<a');
		});
		it('javascript: の画像は出さない', () =>
			expect(renderMarkdown('![x][r]\n\n[r]: javascript:alert(1)')).not.toContain('javascript:'));
		it('data: のショートカット参照リンクはリンクにしない', () => {
			const html = renderMarkdown('[x]\n\n[x]: data:text/html,hi');
			expect(html).not.toContain('data:');
			expect(html).not.toContain('<a');
		});
		it('安全な参照リンクには rel と target を付ける', () => {
			const html = renderMarkdown('[x][r]\n\n[r]: https://example.com');
			expect(html).toContain('href="https://example.com"');
			expect(html).toContain('rel="noopener noreferrer nofollow"');
			expect(html).toContain('target="_blank"');
		});
		it('参照画像は .md-img で包む', () =>
			expect(renderMarkdown('![shot][r]\n\n[r]: /a.png')).toContain(
				'<span class="md-img"><img src="/a.png" alt="shot"></span>'
			));
		it('定義のない参照は書かれたまま文字にする', () => {
			const html = renderMarkdown('[x][nope]');
			expect(html).toContain('[x][nope]');
			expect(html).not.toContain('<a');
		});
	});

	describe('課題キーのリンク', () => {
		const keys = new Set(['DEMO', 'WEB_APP']);
		const render = (src: string) => renderMarkdown(src, { projectKeys: keys });

		it('見られるプロジェクトのキーは、同じタブで開く課題へのリンクにする', () => {
			const html = render('DEMO-12 と WEB_APP-3 を参照');
			expect(hrefs(html)).toEqual(['/projects/DEMO/issues/12', '/projects/WEB_APP/issues/3']);
			expect(html).toContain('<a href="/projects/DEMO/issues/12" class="issue-ref">DEMO-12</a>');
			expect(html).not.toContain('target');
		});
		it('日本語に挟まれていてもリンクにする', () =>
			expect(hrefs(render('これはDEMO-3の件'))).toEqual(['/projects/DEMO/issues/3']));
		it('見出し・強調・表・箇条書きの中もリンクにする', () =>
			expect(
				hrefs(render('# DEMO-1\n\n**DEMO-2**\n\n- DEMO-3\n\n| a |\n| - |\n| DEMO-4 |'))
			).toEqual([
				'/projects/DEMO/issues/1',
				'/projects/DEMO/issues/2',
				'/projects/DEMO/issues/3',
				'/projects/DEMO/issues/4'
			]));
		it('知らないキー・前後に英数字が続くもの・先頭ゼロ・小文字はリンクにしない', () => {
			for (const src of [
				'UTF-8',
				'OTHER-1',
				'XDEMO-1',
				'DEMO-1a',
				'DEMO-01',
				'demo-1',
				'A-DEMO-1'
			]) {
				expect(render(src), src).not.toContain('<a');
			}
		});
		it('コード・既存のリンク・URL の中はリンクにしない', () => {
			for (const src of [
				'`DEMO-1`',
				'```\nDEMO-1\n```',
				'[DEMO-1](https://example.com/)',
				'https://example.com/DEMO-1'
			]) {
				expect(hrefs(render(src)), src).not.toContain('/projects/DEMO/issues/1');
			}
		});
		it('キーを渡さなければリンクにしない', () =>
			expect(renderMarkdown('DEMO-1')).not.toContain('<a'));
	});
});

describe('Backlog 記法から変換した Markdown の表示', () => {
	const view = (backlog: string) => renderMarkdown(backlogToMarkdown(backlog));

	it('約物で終わる太字の後に文字が続いても太字になる', () => {
		expect(view("''「重要」''です")).toBe('<p>「<strong>重要</strong>」です</p>');
	});

	it('Markdown の記号は書かれた文字のまま表示する', () => {
		expect(view('__init__.py と *注* と 1~2 と `x`')).toBe(
			'<p>__init__.py と *注* と 1~2 と `x`</p>'
		);
	});

	it('チェックリストはタスクリストとして表示する', () => {
		expect(view('- [ ] A\n- [x] B')).toContain('<input type="checkbox" checked disabled> B');
	});
});
