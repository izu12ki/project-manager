import { $isCodeNode } from '@lexical/code-core';
import {
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
	type TextNode
} from 'lexical';
import { findMentionQuery, type MentionCandidate } from '$lib/mentions';
import { $createMentionNode } from './nodes';

/** 折りたたまれた選択が text ノードの中にあるとき、そのノードの先頭からキャレットまでを調べる */
function $mentionRange(): { start: number; end: number; query: string } | null {
	const sel = $getSelection();
	if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null;
	const { key, offset } = sel.anchor;
	const node = sel.anchor.getNode();
	if (!$isTextNode(node) || node.getKey() !== key || node.hasFormat('code')) return null;
	if ($isCodeNode(node.getParent())) return null;
	const q = findMentionQuery(node.getTextContent().slice(0, offset), offset);
	return q && { start: q.start, end: offset, query: q.query };
}

function caretRect(): DOMRect | null {
	try {
		const s = window.getSelection();
		if (!s || s.rangeCount === 0) return null;
		const r = s.getRangeAt(0);
		const rect = r.getBoundingClientRect();
		// 空の行ではキャレットの範囲が 0 になるので、親の位置を使う
		if (rect.width === 0 && rect.height === 0) {
			const el =
				r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement;
			return el?.getBoundingClientRect() ?? null;
		}
		return rect;
	} catch {
		return null;
	}
}

export function currentMentionQuery(
	editor: LexicalEditor
): { query: string; rect: DOMRect | null } | null {
	const q = editor.read(() => $mentionRange());
	return q && { query: q.query, rect: caretRect() };
}

/** キャレット直前の `@query` を消して、MentionNode と空白 1 つを入れる */
export function insertMention(editor: LexicalEditor, c: MentionCandidate): void {
	editor.update(
		() => {
			const q = $mentionRange();
			const sel = $getSelection();
			if (!q || !$isRangeSelection(sel)) return;
			// 範囲を消して、選択を @ のあった位置に置く
			(sel.anchor.getNode() as TextNode).spliceText(q.start, q.end - q.start, '', true);
			const name = c.name.replace(/[\]\n\r]/g, '').slice(0, 100) || '?';
			const space = $createTextNode(' ');
			sel.insertNodes([$createMentionNode(name, c.id), space]);
			space.selectEnd();
		},
		{ discrete: true }
	);
}

/** 日本語入力の変換確定の Enter などは、メニューの操作として扱わない */
export function shouldHandleMenuKey(e: KeyboardEvent): boolean {
	return !e.isComposing;
}

/** メニューが開いているときのキー操作。handler が true を返したら Lexical 側の処理を止める */
export function registerMentionKeys(
	editor: LexicalEditor,
	handler: (e: KeyboardEvent) => boolean
): () => void {
	return editor.registerCommand(
		KEY_DOWN_COMMAND,
		(e) => {
			if (!shouldHandleMenuKey(e) || !handler(e)) return false;
			e.preventDefault();
			e.stopPropagation();
			return true;
		},
		COMMAND_PRIORITY_HIGH
	);
}
