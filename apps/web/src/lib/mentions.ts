export interface MentionCandidate {
	id: string;
	name: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `@[表示名](user:<uuid>)`。キャプチャ 1 = 表示名、2 = userId */
export const MENTION_SOURCE = `@\\[([^\\]\\n]{1,100})\\]\\(user:(${UUID})\\)`;
const mentionRe = () => new RegExp(MENTION_SOURCE, 'g');

export function mentionToken(c: MentionCandidate): string {
	const name = c.name.replace(/[\]\n\r]/g, '').slice(0, 100) || '?';
	return `@[${name}](user:${c.id})`;
}

/** コードブロック（```）とインラインコード（`）を取り除く。描画と同じくコード内はメンションにしない */
function stripCode(text: string): string {
	return text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractMentionIds(text: string): string[] {
	return [...new Set(Array.from(stripCode(text).matchAll(mentionRe()), (m) => m[2]))];
}

export function mentionsToPlain(text: string): string {
	return text.replace(mentionRe(), (_, name: string) => `@${name}`);
}

/** キャレット直前の `@xxx` を探す。`@` は行頭か空白の直後で、xxx に空白は含まない */
export function findMentionQuery(
	value: string,
	caret: number
): { start: number; query: string } | null {
	const m = value.slice(0, caret).match(/(?:^|\s)@([^\s@[\]()]{0,30})$/);
	if (!m) return null;
	return { start: caret - m[1].length - 1, query: m[1] };
}

export function filterCandidates(
	cands: MentionCandidate[],
	query: string,
	limit = 8
): MentionCandidate[] {
	const q = query.toLowerCase();
	return cands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, limit);
}
