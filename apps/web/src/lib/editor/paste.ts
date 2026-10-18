import { $generateNodesFromMarkdownString } from '@lexical/mdast';
import { mergeRegister } from '@lexical/utils';
import {
	$insertNodes,
	COMMAND_PRIORITY_LOW,
	defineExtension,
	PASTE_COMMAND,
	TextNode
} from 'lexical';

/** 区切り行（`| --- | :-: |` など）を含む Markdown の表があるか */
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/m;

/**
 * 外から貼った文字の色・フォント・背景は使わない。
 * Markdown では表せず、style はこのエディタでは一切使わないので、常に空に戻す。
 * 外部の画像は ImageNode に importDOM がないため取り込まれない。
 * HTML の表は RawMarkdownNode の importDOM で Markdown の表として取り込む。
 * Markdown の表を文字のまま貼ったときは、表として読めるよう Markdown として取り込む
 */
export const PasteCleanupExtension = defineExtension({
	name: 'project-manager/paste-cleanup',
	register: (editor) =>
		mergeRegister(
			editor.registerNodeTransform(TextNode, (node) => {
				if (node.getStyle() !== '') node.setStyle('');
			}),
			editor.registerCommand(
				PASTE_COMMAND,
				(e) => {
					const data = 'clipboardData' in e ? e.clipboardData : null;
					if (!data || data.files.length > 0) return false;
					if (/<table[\s>]/i.test(data.getData('text/html'))) return false;
					const text = data.getData('text/plain');
					if (!TABLE_DELIMITER.test(text)) return false;
					e.preventDefault();
					editor.update(() => $insertNodes($generateNodesFromMarkdownString(text)));
					return true;
				},
				COMMAND_PRIORITY_LOW
			)
		)
});
