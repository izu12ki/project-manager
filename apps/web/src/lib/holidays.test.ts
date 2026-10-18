import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holidayName, holidaysOf } from './holidays';

/** 内閣府 syukujitsu.csv（UTF-8 に変換済み）: 'YYYY-MM-DD' → 名称 */
function loadCsv(): Map<string, string> {
	const text = readFileSync(new URL('./testdata/syukujitsu.csv', import.meta.url), 'utf8');
	return new Map(
		text
			.trim()
			.split('\n')
			.slice(1)
			.map((line) => {
				const [date, name] = line.split(',');
				const [y, m, d] = date.split('/').map(Number);
				return [`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, name];
			})
	);
}

/** 自前の名称を CSV の表記に寄せる（CSV は振替休日・国民の休日をどちらも「休日」と書く） */
function asCsvName(date: string, name: string): string {
	if (name === '振替休日' || name === '国民の休日') return '休日';
	if (name === '即位の日' || (name === '即位礼正殿の儀' && date.startsWith('2019-'))) {
		return '休日（祝日扱い）';
	}
	return name;
}

describe('holidays', () => {
	it('内閣府の祝日 CSV に載っている全期間で、祝日の日付と名称が一致する', () => {
		const expected = loadCsv();
		const years = [...expected.keys()].map((d) => Number(d.slice(0, 4)));
		const actual = new Map<string, string>();
		for (let y = Math.min(...years); y <= Math.max(...years); y++) {
			for (const [d, n] of holidaysOf(y)) actual.set(d, asCsvName(d, n));
		}
		expect(actual).toEqual(expected);
	});

	it('代表的な振替休日・国民の休日・特例の祝日', () => {
		expect(holidayName('2026-05-06')).toBe('振替休日');
		expect(holidayName('2026-09-22')).toBe('国民の休日');
		expect(holidayName('2019-05-01')).toBe('即位の日');
		expect(holidayName('2021-07-22')).toBe('海の日');
		expect(holidayName('2021-07-23')).toBe('スポーツの日');
		expect(holidayName('2021-08-08')).toBe('山の日');
		expect(holidayName('2021-08-09')).toBe('振替休日');
		expect(holidayName('2026-10-15')).toBeUndefined();
	});

	it('年の祝日は日付順に並ぶ', () => {
		const dates = [...holidaysOf(2026).keys()];
		expect(dates).toEqual([...dates].sort());
		expect(dates[0]).toBe('2026-01-01');
	});
});
