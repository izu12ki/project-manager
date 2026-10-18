// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { $getRoot, $isTextNode, type TextNode } from 'lexical';
import { activeFormats, runFormat, setLink } from './commands';
import { createMarkdownEditor } from './create-editor';

/** md を読み込み、本文全体（最初の文字から最後の文字まで）を選択した状態にする */
function selectAll(md: string) {
	const h = createMarkdownEditor({});
	h.setMarkdown(md);
	h.editor.update(
		() => {
			const texts = $getRoot().getAllTextNodes();
			const first = texts[0] as TextNode;
			const last = texts.at(-1) as TextNode;
			const sel = first.select(0, 0);
			sel.focus.set(last.getKey(), last.getTextContentSize(), 'text');
		},
		{ discrete: true }
	);
	return h;
}

/** md を読み込み、最初のテキストの offset にキャレットを置く */
function caretAt(md: string, offset = 0) {
	const h = createMarkdownEditor({});
	h.setMarkdown(md);
	h.editor.update(
		() => {
			const t = $getRoot().getAllTextNodes()[0];
			if ($isTextNode(t)) t.select(offset, offset);
		},
		{ discrete: true }
	);
	return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runFormat', () => {
	it.each([
		['bold', '**abc**'],
		['strikethrough', '~~abc~~'],
		['code', '`abc`']
	] as const)('%s は選択範囲の文字書式を切り替える', async (f, md) => {
		const h = selectAll('abc');
		runFormat(h.editor, f);
		await flush();
		expect(h.getMarkdown()).toBe(md);
		expect(activeFormats(h.editor).has(f)).toBe(true);
		runFormat(h.editor, f);
		await flush();
		expect(h.getMarkdown()).toBe('abc');
	});

	it('複数の段落にまたがる選択でのコードはコードブロックにする', async () => {
		const h = selectAll('a\n\nb');
		runFormat(h.editor, 'code');
		await flush();
		expect(h.getMarkdown()).toMatch(/^```\na\nb\n```$/);
	});

	it('bullet と check はリストにし、もう一度で戻す', async () => {
		const h = caretAt('abc');
		runFormat(h.editor, 'bullet');
		await flush();
		expect(h.getMarkdown()).toBe('- abc');
		expect(activeFormats(h.editor)).toEqual(new Set(['bullet']));
		runFormat(h.editor, 'check');
		await flush();
		expect(h.getMarkdown()).toBe('- [ ] abc');
		expect(activeFormats(h.editor)).toEqual(new Set(['check']));
		runFormat(h.editor, 'check');
		await flush();
		expect(h.getMarkdown()).toBe('abc');
	});
});

describe('setLink', () => {
	it('選択範囲をリンクにし、null で外す', async () => {
		const h = selectAll('abc');
		setLink(h.editor, 'https://example.com');
		await flush();
		expect(h.getMarkdown()).toBe('[abc](https://example.com)');
		expect(activeFormats(h.editor).has('link')).toBe(true);
		setLink(h.editor, null);
		await flush();
		expect(h.getMarkdown()).toBe('abc');
	});

	it('選択が空なら URL を文字にしたリンクを入れる', async () => {
		const h = caretAt('abc', 3);
		setLink(h.editor, 'https://example.com');
		await flush();
		// 文字と URL が同じリンクは自動リンクの形で書き出される（表示は同じ）
		expect(h.getMarkdown()).toBe('abc<https://example.com>');
	});
});
