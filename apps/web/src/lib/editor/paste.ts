import { defineExtension, TextNode } from 'lexical';

/**
 * 外から貼った文字の色・フォント・背景は使わない。
 * Markdown では表せず、style はこのエディタでは一切使わないので、常に空に戻す。
 * 外部の画像は ImageNode に importDOM がないため取り込まれず、表のセルは段落のテキストになる。
 */
export const PasteCleanupExtension = defineExtension({
	name: 'project-manager/paste-cleanup',
	register: (editor) =>
		editor.registerNodeTransform(TextNode, (node) => {
			if (node.getStyle() !== '') node.setStyle('');
		})
});
