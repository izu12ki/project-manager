import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import type { Element, ElementContent, Parents as HastParents } from 'hast';
import type { Nodes, PhrasingContent, Root } from 'mdast';
import { mentionFromMarkdown, type MentionMdast } from '$lib/markdown/mention-mdast';
import { isAllowedUrl, linkifyMdast } from './linkify-mdast';

/** 生の HTML は解釈せず、書かれたままの文字として表示する */
function htmlToText(node: Nodes): void {
	if (!('children' in node)) return;
	const children = node.children as Nodes[];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type === 'html') {
			const text = { type: 'text' as const, value: child.value };
			// ブロックの html は段落に包む（root / blockquote / listItem 直下に text は置けない）
			children[i] = (
				node.type === 'root' || node.type === 'blockquote' || node.type === 'listItem'
					? { type: 'paragraph', children: [text] }
					: text
			) as Nodes;
		} else {
			htmlToText(child);
		}
	}
}

/** コード以外の text の改行を break に変える（markdown-it の breaks: true 相当） */
function breakNewlines(node: Nodes): void {
	if (node.type === 'code' || node.type === 'inlineCode' || !('children' in node)) return;
	const children = node.children as Nodes[];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type === 'text' && child.value.includes('\n')) {
			const out: PhrasingContent[] = [];
			child.value.split('\n').forEach((line, idx) => {
				if (idx > 0) out.push({ type: 'break' });
				if (line !== '') out.push({ type: 'text', value: line });
			});
			children.splice(i, 1, ...out);
			i += out.length - 1;
		} else {
			breakNewlines(child);
		}
	}
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** hast-util-to-html は text の `>` を escape しないので、text を自前で escape して raw として渡す */
function escapeText(node: HastParents): void {
	node.children.forEach((child, i) => {
		if (child.type === 'text') {
			(node.children as unknown[])[i] = {
				type: 'raw',
				value: child.value.replace(/[&<>]/g, (c) => ESCAPES[c])
			};
		} else if (child.type === 'element') {
			escapeText(child);
		}
	});
}

export function renderMarkdown(src: string): string {
	const tree: Root = fromMarkdown(src, {
		extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem()],
		mdastExtensions: [
			gfmStrikethroughFromMarkdown(),
			gfmTableFromMarkdown(),
			gfmTaskListItemFromMarkdown(),
			mentionFromMarkdown()
		]
	});
	htmlToText(tree);
	linkifyMdast(tree);
	breakNewlines(tree);

	const hast = toHast(tree, {
		handlers: {
			mention: (_state, node) => {
				const m = node as unknown as MentionMdast;
				const el: Element = {
					type: 'element',
					tagName: 'span',
					properties: { className: ['mention'] },
					children: [{ type: 'text', value: `@${m.name}` }]
				};
				return el;
			},
			link: (state, node) => {
				const children = state.all(node) as ElementContent[];
				if (!isAllowedUrl(node.url)) return children;
				const properties: Element['properties'] = { href: normalizeUri(node.url) };
				if (node.title) properties.title = node.title;
				properties.rel = ['noopener', 'noreferrer', 'nofollow'];
				properties.target = '_blank';
				return { type: 'element', tagName: 'a', properties, children } satisfies Element;
			},
			image: (_state, node) => {
				if (!isAllowedUrl(node.url)) return undefined;
				const properties: Element['properties'] = {
					src: normalizeUri(node.url),
					alt: node.alt ?? ''
				};
				if (node.title) properties.title = node.title;
				// 拡大表示（ImageLightbox）の対象にするため包む
				return {
					type: 'element',
					tagName: 'span',
					properties: { className: ['md-img'] },
					children: [{ type: 'element', tagName: 'img', properties, children: [] }]
				} satisfies Element;
			}
		}
	});
	escapeText(hast as HastParents);
	// raw に変えるのは escapeText が自分で escape した text だけ（toHast は allowDangerousHtml なしなので raw は他に出ない）
	return toHtml(hast, { allowDangerousHtml: true });
}
