// 本文・コメント中の課題キー（PROJ-12）を、その課題へのリンクにする。Backlog と同じ書き方で参照できるようにするため。
import type { Nodes, Parents, PhrasingContent, Root } from 'mdast';

export interface IssueRefMdast {
	type: 'issueRef';
	key: string;
	number: number;
}

declare module 'mdast' {
	interface PhrasingContentMap {
		issueRef: IssueRefMdast;
	}
	interface RootContentMap {
		issueRef: IssueRefMdast;
	}
}

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'mention']);

/**
 * 前に英数字・_・- が付くもの（XPROJ-1、A-PROJ-1）と、後に英数字・_ が続くもの（PROJ-1a）は課題キーとみなさない。
 * 番号は課題ページの URL と同じく先頭ゼロなし、検索と同じく 9 桁まで
 */
const ISSUE_KEY = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9_]+)-([1-9]\d{0,8})(?![A-Za-z0-9_])/g;

function split(value: string, keys: ReadonlySet<string>): PhrasingContent[] | null {
	const out: PhrasingContent[] = [];
	let last = 0;
	for (const m of value.matchAll(ISSUE_KEY)) {
		if (!keys.has(m[1])) continue;
		if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
		out.push({ type: 'issueRef', key: m[1], number: Number(m[2]) });
		last = m.index + m[0].length;
	}
	if (out.length === 0) return null;
	if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
	return out;
}

/** text ノードの中の、keys のプロジェクトの課題キーを issueRef ノードに置き換える */
export function linkIssueKeys(tree: Root, keys: ReadonlySet<string>): void {
	if (keys.size === 0) return;
	const walk = (node: Nodes): void => {
		if (SKIP.has(node.type) || !('children' in node)) return;
		const children = (node as Parents).children as Nodes[];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.type === 'text') {
				const replaced = split(child.value, keys);
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

export const issueRefHref = (r: IssueRefMdast) => `/projects/${r.key}/issues/${r.number}`;
