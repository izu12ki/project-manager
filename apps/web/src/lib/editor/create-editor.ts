import { buildEditorFromExtensions } from '@lexical/extension';
import { HistoryExtension } from '@lexical/history';
import { LinkExtension } from '@lexical/link';
import { CheckListExtension, ListExtension } from '@lexical/list';
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	MdastBlockquoteExtension,
	MdastCodeExtension,
	MdastExtension,
	MdastHeadingExtension,
	MdastHorizontalRuleExtension,
	MdastLinkExtension,
	MdastListExtension,
	MdastShortcutsExtension,
	MdastStrikethroughExtension,
	MdastTaskListExtension
} from '@lexical/mdast';
import { RichTextExtension } from '@lexical/rich-text';
import {
	$getRoot,
	$setSelection,
	CLEAR_HISTORY_COMMAND,
	defineExtension,
	type LexicalEditor
} from 'lexical';
import { MarkdownNodesExtension } from './nodes';
import { PasteCleanupExtension } from './paste';

export interface MarkdownEditorHandle {
	editor: LexicalEditor;
	/** Markdown を読み込み、未編集の基準を取り直す */
	setMarkdown(md: string): void;
	/** 未編集なら setMarkdown で渡した文字列そのものを返す */
	getMarkdown(): string;
	destroy(): void;
}

/** setMarkdown による読み込みの更新に付けるタグ（onChange を呼ばない） */
const LOAD_TAG = 'markdown-load';

export function createMarkdownEditor(opts: {
	root?: HTMLElement | null;
	onChange?: (markdown: string) => void;
}): MarkdownEditorHandle {
	// MdastGfmExtension は使わない（自動リンクと表の編集が入るため）。表は MarkdownNodesExtension で扱う
	const editor = buildEditorFromExtensions(
		defineExtension({
			name: '[root]',
			namespace: 'project-manager-markdown',
			dependencies: [
				RichTextExtension,
				HistoryExtension,
				// ツールバーのコマンド（リスト・チェックリスト・リンク）の処理を登録する
				ListExtension,
				CheckListExtension,
				LinkExtension,
				MdastExtension,
				MdastHeadingExtension,
				MdastBlockquoteExtension,
				MdastListExtension,
				MdastCodeExtension,
				MdastLinkExtension,
				MdastHorizontalRuleExtension,
				MdastStrikethroughExtension,
				MdastTaskListExtension,
				MdastShortcutsExtension,
				MarkdownNodesExtension,
				PasteCleanupExtension
			],
			// layout.css の .markdown で表示側と同じ見た目にするためのクラス
			theme: {
				text: { strikethrough: 'md-strike' },
				code: 'md-code-block',
				list: {
					checklist: 'contains-task-list',
					listitemChecked: 'task-list-item md-checked',
					listitemUnchecked: 'task-list-item md-unchecked',
					nested: { listitem: 'md-nested' }
				}
			},
			onError: (error: Error) => {
				throw error;
			}
		})
	);

	let source = '';
	let baseline = '';

	// 末尾の空白（メンション確定直後など）は mdast が `&#x20;` に直すので、そのまま空白に戻す。
	// 本文の文字が `&#x20;` で終わるとき（`\&#x20;` と書き出される）は変えない
	const exportMarkdown = () =>
		editor.read(() => {
			const md = $convertToMarkdownString();
			return $getRoot().getTextContent().endsWith(' ') ? md.replace(/&#x20;$/, ' ') : md;
		});

	const getMarkdown = () => {
		const md = exportMarkdown();
		return md === baseline ? source : md;
	};

	const setMarkdown = (md: string) => {
		editor.update(
			() => {
				$convertFromMarkdownString(md);
				// 読み込み後のフォーカスで末尾にキャレットを置く（editor.focus の defaultSelection）
				$setSelection(null);
			},
			{ discrete: true, tag: LOAD_TAG }
		);
		source = md;
		baseline = exportMarkdown();
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
	};

	const unregister = editor.registerUpdateListener(
		({ dirtyElements, dirtyLeaves, prevEditorState, tags }) => {
			if (!opts.onChange || tags.has(LOAD_TAG)) return;
			// setRootElement で最初の状態（空の段落）が確定するときは編集ではない。
			// ここで onChange('') を呼ぶと、textarea の既存の値が消える
			if (prevEditorState.isEmpty()) return;
			if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
			opts.onChange(getMarkdown());
		}
	);

	if (opts.root) editor.setRootElement(opts.root);

	return {
		editor,
		setMarkdown,
		getMarkdown,
		destroy() {
			unregister();
			editor.setRootElement(null);
			editor.dispose();
		}
	};
}
