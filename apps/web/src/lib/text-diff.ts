import { diffChars, diffLines } from 'diff';

/** changed は行の中で変わった部分（文字単位） */
export type DiffSegment = { text: string; changed: boolean };
export type DiffRow =
	| { kind: 'same' | 'add' | 'del'; segments: DiffSegment[] }
	/** 省略した変更なしの行 */
	| { kind: 'skip'; count: number };

/** 変更箇所の前後に残す変更なしの行数 */
const CONTEXT = 2;
/** 行内の文字単位の比較を諦める編集量（大きく書き換えた行で重くならないように） */
const MAX_CHAR_EDIT = 2000;

function splitLines(text: string): string[] {
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

/** 区間の並びを行ごとに分ける */
function toLines(segments: DiffSegment[]): DiffSegment[][] {
	const lines: DiffSegment[][] = [[]];
	for (const seg of segments) {
		seg.text.split('\n').forEach((part, i) => {
			if (i > 0) lines.push([]);
			if (part) lines.at(-1)!.push({ text: part, changed: seg.changed });
		});
	}
	if (lines.length > 1 && lines.at(-1)!.length === 0) lines.pop();
	return lines;
}

/** 削除行と追加行の組を、行内の変わった部分に印を付けて返す */
function pairRows(removed: string, added: string): DiffRow[] {
	const chars = diffChars(removed, added, { maxEditLength: MAX_CHAR_EDIT });
	if (!chars) {
		return [
			...splitLines(removed).map((l) => row('del', [{ text: l, changed: false }])),
			...splitLines(added).map((l) => row('add', [{ text: l, changed: false }]))
		];
	}
	const del = chars.filter((c) => !c.added).map((c) => ({ text: c.value, changed: c.removed }));
	const add = chars.filter((c) => !c.removed).map((c) => ({ text: c.value, changed: c.added }));
	return [...toLines(del).map((s) => row('del', s)), ...toLines(add).map((s) => row('add', s))];
}

function row(kind: 'same' | 'add' | 'del', segments: DiffSegment[]): DiffRow {
	return { kind, segments };
}

/** 改行コードと末尾の改行の有無をそろえる（見た目に出ない違いを差分にしない） */
function normalize(text: string): string {
	const t = text.replace(/\r\n/g, '\n');
	return t === '' || t.endsWith('\n') ? t : `${t}\n`;
}

/** 行単位で比べ、変わった行の中は文字単位で印を付ける。離れた変更なしの行は省略する。違いがなければ空配列 */
export function diffText(before: string, after: string): DiffRow[] {
	const parts = diffLines(normalize(before), normalize(after));
	if (parts.every((p) => !p.added && !p.removed)) return [];
	const rows: DiffRow[] = [];
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const next = parts[i + 1];
		if (p.removed && next?.added) {
			rows.push(...pairRows(p.value, next.value));
			i++;
		} else if (p.removed || p.added) {
			const kind = p.added ? 'add' : 'del';
			rows.push(...splitLines(p.value).map((l) => row(kind, [{ text: l, changed: false }])));
		} else {
			const lines = splitLines(p.value).map((l) => row('same', [{ text: l, changed: false }]));
			const head = i === 0 ? 0 : CONTEXT;
			const tail = i === parts.length - 1 ? 0 : CONTEXT;
			if (lines.length > head + tail + 1) {
				rows.push(...lines.slice(0, head));
				rows.push({ kind: 'skip', count: lines.length - head - tail });
				rows.push(...lines.slice(lines.length - tail));
			} else {
				rows.push(...lines);
			}
		}
	}
	return rows;
}
