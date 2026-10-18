import { buildEditorFromExtensions } from '@lexical/extension';
import { HistoryExtension } from '@lexical/history';
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
import { CLEAR_HISTORY_COMMAND, defineExtension, type LexicalEditor } from 'lexical';
import { MarkdownNodesExtension } from './nodes';

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
				MarkdownNodesExtension
			],
			onError: (error: Error) => {
				throw error;
			}
		})
	);

	let source = '';
	let baseline = '';

	const exportMarkdown = () => editor.read(() => $convertToMarkdownString());

	const getMarkdown = () => {
		const md = exportMarkdown();
		return md === baseline ? source : md;
	};

	const setMarkdown = (md: string) => {
		editor.update(() => $convertFromMarkdownString(md), { discrete: true, tag: LOAD_TAG });
		source = md;
		baseline = exportMarkdown();
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
	};

	const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
		if (!opts.onChange || tags.has(LOAD_TAG)) return;
		if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
		opts.onChange(getMarkdown());
	});

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
