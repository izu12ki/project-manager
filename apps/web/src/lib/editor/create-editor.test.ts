// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { $convertToMarkdownString } from '@lexical/mdast';
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isLineBreakNode,
	type ElementNode
} from 'lexical';
import { renderMarkdown } from '$lib/server/markdown';
import { createMarkdownEditor } from './create-editor';
import { $createUploadPlaceholderNode } from './nodes';

const id = '0192f0c1-0000-7000-8000-000000000001';
const roundtrip = (md: string) => {
	const h = createMarkdownEditor({});
	h.setMarkdown(md);
	h.editor.update(() => $getRoot().getLastDescendant()?.markDirty(), { discrete: true });
	return h;
};
const samples = [
	'- a\n  - b\n    - c',
	'- [ ] todo\n- [x] done',
	'3. three\n4. four',
	'# 見出し\n\n> 引用\n\n---',
	'```ts\nconst a = 1;\n```',
	'| a | b |\n| - | - |\n| 1 | 2 |',
	'<br> と <b>x</b>',
	`hi @[田中 太郎](user:${id}) さん`,
	'![shot](/projects/A/attachments/1)',
	'1 行目\n2 行目',
	'~~消す~~ **太字** `code` [l](https://example.com)',
	'see example.com'
];

describe('createMarkdownEditor', () => {
	it.each(samples)('未編集なら元の文字列のまま: %s', (md) => {
		const h = createMarkdownEditor({});
		h.setMarkdown(md);
		expect(h.getMarkdown()).toBe(md);
	});

	it.each(samples)('書き出しても表示は変わらない: %s', (md) => {
		expect(renderMarkdown(roundtrip(md).getMarkdown())).toBe(renderMarkdown(md));
	});

	// getMarkdown は未編集なら元の文字列を返すので、書き出しそのものも確かめる
	it.each([
		...samples,
		'- a\n\n- b',
		'- a\n  - b\n\n  - c',
		'- x\n\n  | a |\n  | - |',
		'> q\n> | a |\n> | - |',
		'* a\n* b',
		'1) x\n2) y',
		'a  \nb'
	])('書き出した Markdown そのものでも表示は変わらない: %s', (md) => {
		const h = createMarkdownEditor({});
		h.setMarkdown(md);
		const exported = h.editor.read(() => $convertToMarkdownString());
		expect(renderMarkdown(exported)).toBe(renderMarkdown(md));
	});

	it('編集したら書き出した Markdown を onChange に渡す（読み込みでは呼ばない）', () => {
		const changes: string[] = [];
		const h = createMarkdownEditor({ onChange: (md) => changes.push(md) });
		h.setMarkdown('* a');
		expect(changes).toEqual([]);
		h.editor.update(
			() => $getRoot().getFirstDescendant<ElementNode>()?.getParent()?.append($createTextNode('b')),
			{ discrete: true }
		);
		expect(changes.at(-1)).toBe('* ab');
		expect(h.getMarkdown()).toBe('* ab');
	});

	it('root を付けたときの最初の状態（空の段落）では onChange を呼ばない', () => {
		const changes: string[] = [];
		const root = document.createElement('div');
		root.contentEditable = 'true';
		document.body.appendChild(root);
		const h = createMarkdownEditor({ root, onChange: (md) => changes.push(md) });
		expect(changes).toEqual([]);
		// 空で読み込んでからの最初の入力は知らせる
		h.setMarkdown('');
		h.editor.update(
			() => {
				const top = $getRoot();
				const p =
					top.getFirstChild<ElementNode>() ??
					top.append($createParagraphNode()).getFirstChild<ElementNode>()!;
				p.append($createTextNode('a'));
			},
			{ discrete: true }
		);
		expect(changes).toEqual(['a']);
		h.destroy();
		root.remove();
	});

	it('空のままなら空', () => {
		const h = createMarkdownEditor({});
		h.setMarkdown('');
		expect(h.getMarkdown()).toBe('');
	});

	it('表は編集できないブロックとして元の Markdown を保つ', () => {
		const md = 'x\n\n| a |\n| - |\n| 1 |';
		expect(roundtrip(md).getMarkdown()).toContain('| a |\n| - |\n| 1 |');
	});

	it('1 回の改行は LineBreakNode として読む', () => {
		const h = createMarkdownEditor({});
		h.setMarkdown('a\nb');
		h.editor.read(() =>
			expect(
				$getRoot().getFirstChildOrThrow<ElementNode>().getChildren().some($isLineBreakNode)
			).toBe(true)
		);
	});

	it('アップロード中の仮の要素は書き出さない', () => {
		const h = createMarkdownEditor({});
		h.setMarkdown('a');
		h.editor.update(
			() =>
				$getRoot()
					.getFirstChildOrThrow<ElementNode>()
					.append($createUploadPlaceholderNode('k', 'f.png')),
			{ discrete: true }
		);
		expect(h.getMarkdown()).toBe('a');
	});
});
