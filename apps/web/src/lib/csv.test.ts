import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { columnIndex, decodeCsv, parseCsv, restoreNewlines } from '#lib/csv.ts';

const fixture = readFileSync(new URL('./testdata/backlog/users.csv', import.meta.url));

describe('decodeCsv', () => {
	it('CP932 のバイト列を読める', () => {
		expect(decodeCsv(fixture)).toContain('髙田 一郎①');
	});

	it('BOM 付きの UTF-8 は BOM を除く', () => {
		const bytes = new TextEncoder().encode('﻿あ,い');
		expect(decodeCsv(bytes)).toBe('あ,い');
	});

	it('BOM なしの UTF-8 もそのまま読む', () => {
		expect(decodeCsv(new TextEncoder().encode('あ,い'))).toBe('あ,い');
	});
});

describe('parseCsv', () => {
	const expected = [
		['a', 'b,c', 'd"e'],
		['f\ng', 'h']
	];

	it('引用符・カンマ・改行・"" を扱う', () => {
		expect(parseCsv('a,"b,c","d""e"\n"f\ng",h\n')).toEqual(expected);
	});

	it('CRLF でも同じ結果になる', () => {
		expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",h\r\n')).toEqual(expected);
	});

	it('末尾と途中の空行は捨てる', () => {
		expect(parseCsv('a,b\n\n\nc,d\n\n')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('閉じていない引用符は最後までを 1 セルにする', () => {
		expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']]);
	});
});

describe('columnIndex', () => {
	it('前後の空白を除いて列を探す', () => {
		expect(columnIndex(['ID', ' 名前 '], ['名前'])).toEqual({ 名前: 1 });
	});

	it('ないと null', () => {
		expect(columnIndex(['ID'], ['名前'])).toBeNull();
	});
});

describe('restoreNewlines', () => {
	it('2 文字の \\n を改行に戻す', () => {
		expect(restoreNewlines('a\\nb\\n\\nc')).toBe('a\nb\n\nc');
		expect(restoreNewlines('改行なし')).toBe('改行なし');
	});
});
