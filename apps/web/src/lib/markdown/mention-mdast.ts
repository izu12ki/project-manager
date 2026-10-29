import type { Extension } from 'mdast-util-from-markdown';
import type { Options } from 'mdast-util-to-markdown';
import type { Nodes, Parents, Root } from 'mdast';
import { MENTION_SOURCE, mentionToken } from '#lib/mentions.ts';

export interface MentionMdast {
	type: 'mention';
	name: string;
	userId: string;
}

declare module 'mdast' {
	interface PhrasingContentMap {
		mention: MentionMdast;
	}
	interface RootContentMap {
		mention: MentionMdast;
	}
}

const FULL_MENTION = new RegExp(`^${MENTION_SOURCE}$`);

/** `user:<uuid>` の URL から uuid を取り出す。uuid の形式判定は MENTION_SOURCE に合わせる */
function userIdFromUrl(url: string): string | null {
	return FULL_MENTION.exec(`@[x](${url})`)?.[2] ?? null;
}

/** `@` で終わる text の直後にある `user:<uuid>` リンクを mention に置き換える（子を再帰的に処理） */
function replaceMentions(node: Nodes): void {
	if (!('children' in node)) return;
	const parent = node as Parents;
	const children = parent.children as Nodes[];
	for (let i = 0; i < children.length; i++) {
		const cur = children[i];
		const prev = children[i - 1];
		if (
			cur.type === 'link' &&
			prev?.type === 'text' &&
			prev.value.endsWith('@') &&
			cur.children.length === 1 &&
			cur.children[0].type === 'text'
		) {
			const userId = userIdFromUrl(cur.url);
			if (userId) {
				prev.value = prev.value.slice(0, -1);
				const mention: MentionMdast = { type: 'mention', name: cur.children[0].value, userId };
				children.splice(i, 1, mention);
				// 末尾の @ だけだった text は空になるので取り除く
				if (prev.value === '') {
					children.splice(i - 1, 1);
					i--;
				}
				continue;
			}
		}
		replaceMentions(cur);
	}
}

export function mentionFromMarkdown(): Extension {
	return {
		transforms: [
			(tree: Root) => {
				replaceMentions(tree);
				return tree;
			}
		]
	};
}

export function mentionToMarkdown(): Options {
	return {
		handlers: {
			mention: (node: MentionMdast) => mentionToken({ id: node.userId, name: node.name })
		}
	};
}
