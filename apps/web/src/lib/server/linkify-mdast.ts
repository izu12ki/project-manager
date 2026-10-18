import { LinkifyIt } from 'linkify-it';
import type { Nodes, Parents, PhrasingContent, Root } from 'mdast';
import { isAllowedUrl } from '$lib/markdown/url';

// markdown-it の既定（`new LinkifyIt()`）と同じ設定。自動リンクの検出結果を揃える
const linkify = new LinkifyIt();

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference']);

function pushText(out: PhrasingContent[], value: string): void {
	if (value !== '') out.push({ type: 'text', value });
}

function pushLink(out: PhrasingContent[], url: string, text: string): void {
	out.push({ type: 'link', url, children: [{ type: 'text', value: text }] });
}

/** linkify-it の通常の検出（左側が境界であることを要求する）。markdown-it のコア規則に相当 */
function splitByMatch(value: string, out: PhrasingContent[]): void {
	const matches = linkify.test(value) ? linkify.match(value) : null;
	let last = 0;
	for (const m of matches ?? []) {
		if (!isAllowedUrl(m.url)) continue;
		pushText(out, value.slice(last, m.index));
		pushLink(out, m.url, m.text);
		last = m.lastIndex;
	}
	pushText(out, value.slice(last));
}

const isAlpha = (c: string) => /[A-Za-z]/.test(c);
const isSchemeChar = (c: string) => /[A-Za-z0-9+.-]/.test(c);

/**
 * `://` を手がかりに、スキーム付き URL を左の境界なしで検出する。
 * markdown-it のインライン規則に相当し、「はhttps://…」のように日本語に続く URL もリンクにする
 */
function splitText(value: string): PhrasingContent[] | null {
	const out: PhrasingContent[] = [];
	let from = 0;
	let found = false;
	const re = /:\/\//g;
	for (let m = re.exec(value); m; m = re.exec(value)) {
		const pos = m.index;
		if (pos < from) continue;
		let start = pos;
		const min = Math.max(from, pos - 10);
		while (start > min && isSchemeChar(value[start - 1])) start--;
		if (start === pos || !isAlpha(value[start])) continue;
		const link = linkify.matchAtStart(value.slice(start));
		if (!link) continue;
		// markdown-it のインライン規則と同じく、URL 末尾の `*` は強調の記号として URL に含めない
		const url = link.url.replace(/\*+$/, '');
		if (url.length <= pos - start || !isAllowedUrl(url)) continue;
		splitByMatch(value.slice(from, start), out);
		pushLink(out, url, url);
		from = start + url.length;
		re.lastIndex = from;
		found = true;
	}
	splitByMatch(value.slice(from), out);
	return found || out.some((n) => n.type === 'link') ? out : null;
}

/** text ノードの中の URL・メールアドレスを link ノードに置き換える（markdown-it の linkify 相当） */
export function linkifyMdast(tree: Root): void {
	const walk = (node: Nodes): void => {
		if (SKIP.has(node.type) || !('children' in node)) return;
		const children = (node as Parents).children as Nodes[];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.type === 'text') {
				const replaced = splitText(child.value);
				if (replaced) {
					children.splice(i, 1, ...replaced);
					i += replaced.length - 1;
				}
			} else {
				walk(child);
			}
		}
	};
	walk(tree);
}
