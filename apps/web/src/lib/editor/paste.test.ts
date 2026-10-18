// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { $generateNodesFromDOM } from '@lexical/html';
import {
	$getRoot,
	$insertNodes,
	$isTextNode,
	$nodesOfType,
	PASTE_COMMAND,
	TextNode
} from 'lexical';
import { createMarkdownEditor } from './create-editor';
import { $isRawMarkdownNode } from './nodes';

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
	it('HTML の表（Excel・スプレッドシート・Web）は Markdown の表にする', () => {
		expect(
			paste(
				'<p>前</p><table><tr><td>列1</td><td>列2</td></tr><tr><td>データ1</td><td>データ2</td></tr></table><p>後</p>'
			)
		).toBe('前\n\n| 列1 | 列2 |\n| --- | --- |\n| データ1 | データ2 |\n\n後');
	});
});

describe('Markdown の表を文字のまま貼り付ける', () => {
	const table = '| 列1 | 列2 |\n| ---- | ---- |\n| データ1 | データ2 |';

	/** 文字（と HTML）の貼り付けを、ブラウザの貼り付けと同じく PASTE_COMMAND で送る */
	function pastePlain(text: string, html = '') {
		const h = createMarkdownEditor({});
		h.setMarkdown('');
		h.editor.update(() => $getRoot().selectEnd(), { discrete: true });
		const data = {
			types: html ? ['text/plain', 'text/html'] : ['text/plain'],
			files: [] as File[],
			getData: (t: string) => (t === 'text/plain' ? text : t === 'text/html' ? html : '')
		};
		const event = { clipboardData: data, preventDefault: () => {} };
		h.editor.update(
			() => {
				h.editor.dispatchCommand(PASTE_COMMAND, event as unknown as ClipboardEvent);
			},
			{ discrete: true }
		);
		return h;
	}
	const hasTable = (h: ReturnType<typeof pastePlain>) =>
		h.editor.read(() => $getRoot().getChildren().some($isRawMarkdownNode));

	it('表を含む文字は Markdown として取り込み、表にする', () => {
		const h = pastePlain(`説明\n\n${table}`);
		expect(h.getMarkdown()).toBe(`説明\n\n${table}`);
		expect(hasTable(h)).toBe(true);
	});

	it('表を含まない文字は今までどおり文字のまま貼る', () => {
		const h = pastePlain('ただの **文字**');
		expect(h.getMarkdown()).toBe('ただの \\*\\*文字\\*\\*');
		expect(hasTable(h)).toBe(false);
	});

	it('HTML に表があるときは HTML の表を取り込む', () => {
		const h = pastePlain(table, '<table><tr><td>1</td><td>2</td></tr></table>');
		expect(h.getMarkdown()).toBe('| 1 | 2 |\n| --- | --- |');
	});
});
