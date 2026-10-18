// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $insertNodes, $isTextNode, $nodesOfType, TextNode } from 'lexical';
import { createMarkdownEditor } from './create-editor';

/** 外から貼られた HTML を、貼り付けと同じ経路でエディタに入れて Markdown を返す */
function paste(html: string): string {
	const h = createMarkdownEditor({});
	h.setMarkdown('');
	h.editor.update(
		() => {
			$getRoot().selectEnd();
			const dom = new DOMParser().parseFromString(html, 'text/html');
			$insertNodes($generateNodesFromDOM(h.editor, dom));
		},
		{ discrete: true }
	);
	return h.getMarkdown();
}

describe('外からの貼り付け', () => {
	it('太字・リンク・リストは残す', () => {
		expect(paste('<p><b>a</b> <a href="https://x.test">l</a></p><ul><li>i</li></ul>')).toBe(
			'**a** [l](https://x.test)\n\n- i'
		);
	});
	it('斜体・取り消し線・コード・見出し・引用は残す', () => {
		const md = paste(
			'<h2>t</h2><p><i>a</i> <s>b</s> <code>c</code></p><blockquote><p>q</p></blockquote>'
		);
		expect(md).toContain('## t');
		expect(md).toContain('*a*');
		expect(md).toContain('~~b~~');
		expect(md).toContain('`c`');
		expect(md).toContain('> q');
	});
	it('文字色は捨てる', () => expect(paste('<p><span style="color:red">a</span></p>')).toBe('a'));
	it('フォントと背景色は捨てる', () => {
		const h = createMarkdownEditor({});
		h.setMarkdown('');
		h.editor.update(
			() => {
				$getRoot().selectEnd();
				const dom = new DOMParser().parseFromString(
					'<p><span style="font-family:Foo;background-color:#ff0">a</span></p>',
					'text/html'
				);
				$insertNodes($generateNodesFromDOM(h.editor, dom));
			},
			{ discrete: true }
		);
		const styles = h.editor.read(() =>
			$nodesOfType(TextNode)
				.filter((n) => $isTextNode(n))
				.map((n) => n.getStyle())
		);
		// 空の配列では every が常に true になるので、テキストが入ったことも確かめる
		expect(styles.length).toBeGreaterThan(0);
		expect(styles.every((s) => s === '')).toBe(true);
	});
	it('テキストに付いた style は常に空に戻す', () => {
		const h = createMarkdownEditor({});
		h.setMarkdown('a');
		h.editor.update(
			() => {
				for (const n of $getRoot().getAllTextNodes()) n.setStyle('color: red; font-family: Foo');
			},
			{ discrete: true }
		);
		const styles = h.editor.read(() =>
			$getRoot()
				.getAllTextNodes()
				.map((n) => n.getStyle())
		);
		expect(styles).toEqual(['']);
	});
	it('外部の画像は取り込まない', () =>
		expect(paste('<p>a<img src="https://evil.test/x.png">b</p>')).toBe('ab'));
	it('表はテキストになる', () => {
		const md = paste('<table><tr><td>1</td><td>2</td></tr></table>');
		expect(md).not.toContain('<table');
		expect(md).toContain('1');
		expect(md).toContain('2');
	});
});
