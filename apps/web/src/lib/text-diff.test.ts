import { describe, expect, it } from 'vitest';
import { diffText, type DiffRow } from './text-diff';

/** 行を「記号 + 本文」にし、変わった部分を [ ] で囲む */
function show(rows: DiffRow[]): string[] {
	return rows.map((r) => {
		if (r.kind === 'skip') return `… ${r.count}`;
		const mark = { same: ' ', add: '+', del: '-' }[r.kind];
		return mark + r.segments.map((s) => (s.changed ? `[${s.text}]` : s.text)).join('');
	});
}

describe('diffText', () => {
	it('書き換えた行は削除と追加の組にし、行内の変わった文字に印を付ける', () => {
		expect(
			show(diffText('概要\n明日までに対応する\n以上', '概要\n来週までに対応する\n以上'))
		).toEqual([' 概要', '-[明日]までに対応する', '+[来週]までに対応する', ' 以上']);
	});

	it('追加・削除だけの行', () => {
		expect(show(diffText('a\nb', 'a\nb\nc'))).toEqual([' a', ' b', '+c']);
		expect(show(diffText('a\nb\nc', 'a\nc'))).toEqual([' a', '-b', ' c']);
	});

	it('変更から離れた変更なしの行は省略する', () => {
		const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
		const after = before.replace('5', '五');
		expect(show(diffText(before, after))).toEqual([
			'… 2',
			' 3',
			' 4',
			'-[5]',
			'+[五]',
			' 6',
			' 7',
			'… 2'
		]);
	});

	it('空から書いた場合と、全部消した場合', () => {
		expect(show(diffText('', 'a\nb'))).toEqual(['+a', '+b']);
		expect(show(diffText('a', ''))).toEqual(['-a']);
	});

	it('改行コードや末尾の改行だけの違いは差分にしない', () => {
		expect(diffText('a\r\nb', 'a\nb\n')).toEqual([]);
	});
});
