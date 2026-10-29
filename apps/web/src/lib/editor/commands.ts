import { $createCodeNode, $isCodeNode } from '@lexical/code-core';
import { $createLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
	$isListItemNode,
	$isListNode,
	INSERT_CHECK_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
	REMOVE_LIST_COMMAND
} from '@lexical/list';
import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	FORMAT_TEXT_COMMAND,
	INDENT_CONTENT_COMMAND,
	KEY_TAB_COMMAND,
	OUTDENT_CONTENT_COMMAND,
	type LexicalEditor,
	type LexicalNode,
	type RangeSelection
} from 'lexical';
import { normalizeLinkUrl } from '#lib/markdown/url.ts';

export type Format = 'bold' | 'strikethrough' | 'code' | 'link' | 'bullet' | 'check' | 'quote';

/** 選択の起点がいるリストの種類（リストの外なら null） */
function $listType(selection: RangeSelection) {
	const list = $findMatchingParent(selection.anchor.getNode(), $isListNode);
	return list ? list.getListType() : null;
}

const $inCodeBlock = (selection: RangeSelection) =>
	$findMatchingParent(selection.anchor.getNode(), $isCodeNode) !== null;

/** 複数のブロックにまたがる選択か */
function $spansBlocks(selection: RangeSelection) {
	const a = selection.anchor.getNode().getTopLevelElement();
	const b = selection.focus.getNode().getTopLevelElement();
	return !!a && !!b && !a.is(b);
}

const $inQuote = (selection: RangeSelection) =>
	$findMatchingParent(selection.anchor.getNode(), $isQuoteNode) !== null;

const $inLink = (node: LexicalNode) => $findMatchingParent(node, $isLinkNode) !== null;

export function activeFormats(editor: LexicalEditor): Set<Format> {
	return editor.read(() => {
		const active = new Set<Format>();
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return active;
		for (const f of ['bold', 'strikethrough', 'code'] as const) {
			if (selection.hasFormat(f)) active.add(f);
		}
		if ($inCodeBlock(selection)) active.add('code');
		if ($inLink(selection.anchor.getNode())) active.add('link');
		const list = $listType(selection);
		if (list === 'bullet') active.add('bullet');
		if (list === 'check') active.add('check');
		if ($inQuote(selection)) active.add('quote');
		return active;
	});
}

export function runFormat(editor: LexicalEditor, f: Format): void {
	switch (f) {
		case 'bold':
		case 'strikethrough':
			editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
			return;
		case 'code':
			return runCode(editor);
		case 'link':
			// 付ける側は URL が要るので setLink を使う。ここではリンクを外す
			setLink(editor, null);
			return;
		case 'quote':
			// 引用の中なら段落に戻し、外なら選択したブロックを引用にする
			editor.update(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return;
				if ($inQuote(selection)) $setBlocksType(selection, $createParagraphNode);
				else $setBlocksType(selection, () => $createQuoteNode());
			});
			return;
		case 'bullet':
		case 'check': {
			const current = editor.read(() => {
				const selection = $getSelection();
				return $isRangeSelection(selection) ? $listType(selection) : null;
			});
			if (current === f) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
			else
				editor.dispatchCommand(
					f === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_CHECK_LIST_COMMAND,
					undefined
				);
		}
	}
}

/** 1 行の選択はインラインコード、複数行ならコードブロック（コードブロックの中なら段落に戻す） */
function runCode(editor: LexicalEditor) {
	const block = editor.read(() => {
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return null;
		if ($inCodeBlock(selection)) return 'unwrap';
		if ($spansBlocks(selection) || selection.getTextContent().includes('\n')) return 'wrap';
		return null;
	});
	if (block === null) {
		editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
		return;
	}
	editor.update(() => {
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return;
		if (block === 'unwrap') return $setBlocksType(selection, $createParagraphNode);
		// $setBlocksType はブロックごとに CodeNode を作るので、1 つのコードブロックにまとめる
		const code = $createCodeNode();
		selection
			.getTextContent()
			.split('\n')
			.forEach((line, i) => {
				if (i > 0) code.append($createLineBreakNode());
				if (line) code.append($createTextNode(line));
			});
		selection.insertNodes([code]);
		code.selectEnd();
	});
}

/**
 * 選択範囲にリンクを付ける（null なら外す）。選択が空なら URL を文字にして入れる。
 * スキームのない URL には https:// を付け、使えない URL ならリンクを作らずに false を返す
 */
export function setLink(editor: LexicalEditor, input: string | null): boolean {
	const url = input === null ? null : normalizeLinkUrl(input);
	if (input !== null && url === null) return false;
	const collapsed = editor.read(() => {
		const selection = $getSelection();
		return $isRangeSelection(selection) && selection.isCollapsed();
	});
	if (url && collapsed) {
		editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;
			const link = $createLinkNode(url);
			link.append($createTextNode(input!.trim()));
			selection.insertNodes([link]);
		});
		return true;
	}
	editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
	return true;
}

/**
 * リストの中の Tab / Shift+Tab でネストを深く・浅くする。
 * リストの外では何もしない（ブラウザのフォーカス移動に任せる）。
 */
export function registerListTab(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerCommand(
			KEY_TAB_COMMAND,
			(event) => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return false;
				if (!$findMatchingParent(selection.anchor.getNode(), $isListItemNode)) return false;
				event.preventDefault();
				return editor.dispatchCommand(
					event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
					undefined
				);
			},
			COMMAND_PRIORITY_LOW
		)
	);
}
