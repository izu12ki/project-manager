/**
 * 日本の祝日（国民の祝日・振替休日・国民の休日）を規則から計算する。
 *
 * 次の実装を TypeScript に移植し、日付を 'YYYY-MM-DD' と UTC だけで扱うようにしたもの。
 * japanese-holidays-js (https://github.com/osamutake/japanese-holidays-js)
 * Copyright (c) 2016 Osamu Takeuchi <osamu@big.jp> — The MIT License (MIT)
 *
 * 祝日法の改正で祝日が増えたり変わったりしたら RULES を直す。
 * 正しさは内閣府の syukujitsu.csv と突き合わせて確認している（holidays.test.ts）。
 */

const DAY_MS = 86_400_000;

function iso(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}
function ymd(y: number, m: number, d: number): string {
	return iso(Date.UTC(y, m - 1, d));
}
function shift(date: string, days: number): string {
	return iso(Date.parse(date) + days * DAY_MS);
}
function weekday(date: string): number {
	return new Date(date).getUTCDay();
}

const fixed = (m: number, d: number) => (y: number) => ymd(y, m, d);

/** m 月の第 nth 月曜 */
const happyMonday = (m: number, nth: number) => (y: number) => {
	const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
	return ymd(y, m, 1 + ((8 - dow) % 7) + (nth - 1) * 7);
};

/** 春分・秋分の瞬間（ms）を日本時間の日付にする */
const jstDate = (ms: number) => iso(ms + 9 * 3_600_000);
const shunbun = (y: number) => jstDate(-655_866_700_000 + 31_556_940_400 * (y - 1949));
/** 近似式がずれる年の補正 */
const SHUBUN_FIX: Record<number, number> = { 2074: 23 };
const shubun = (y: number) =>
	SHUBUN_FIX[y]
		? ymd(y, 9, SHUBUN_FIX[y])
		: jstDate(-671_316_910_000 + 31_556_910_000 * (y - 1948));

type Rule = readonly [name: string, date: (y: number) => string, from: number, to?: number];

/** 名前・日付の求め方・施行年・廃止年。1 回限りのものは from = to。名前は内閣府 CSV の表記に合わせる */
const RULES: readonly Rule[] = [
	['元日', fixed(1, 1), 1949],
	['成人の日', fixed(1, 15), 1949, 1999],
	['成人の日', happyMonday(1, 2), 2000],
	['建国記念の日', fixed(2, 11), 1967],
	['天皇誕生日', fixed(2, 23), 2020],
	['大喪の礼', fixed(2, 24), 1989, 1989],
	['春分の日', shunbun, 1949],
	['結婚の儀', fixed(4, 10), 1959, 1959],
	['天皇誕生日', fixed(4, 29), 1949, 1988],
	['みどりの日', fixed(4, 29), 1989, 2006],
	['昭和の日', fixed(4, 29), 2007],
	['即位の日', fixed(5, 1), 2019, 2019],
	['憲法記念日', fixed(5, 3), 1949],
	['みどりの日', fixed(5, 4), 2007],
	['こどもの日', fixed(5, 5), 1949],
	['結婚の儀', fixed(6, 9), 1993, 1993],
	['海の日', fixed(7, 20), 1996, 2002],
	['海の日', happyMonday(7, 3), 2003, 2019],
	['海の日', fixed(7, 23), 2020, 2020],
	['海の日', fixed(7, 22), 2021, 2021],
	['海の日', happyMonday(7, 3), 2022],
	['山の日', fixed(8, 11), 2016, 2019],
	['山の日', fixed(8, 10), 2020, 2020],
	['山の日', fixed(8, 8), 2021, 2021],
	['山の日', fixed(8, 11), 2022],
	['敬老の日', fixed(9, 15), 1966, 2002],
	['敬老の日', happyMonday(9, 3), 2003],
	['秋分の日', shubun, 1948],
	['体育の日', fixed(10, 10), 1966, 1999],
	['体育の日', happyMonday(10, 2), 2000, 2018],
	['体育の日（スポーツの日）', happyMonday(10, 2), 2019, 2019],
	['スポーツの日', fixed(7, 24), 2020, 2020],
	['スポーツの日', fixed(7, 23), 2021, 2021],
	['スポーツの日', happyMonday(10, 2), 2022],
	['即位礼正殿の儀', fixed(10, 22), 2019, 2019],
	['文化の日', fixed(11, 3), 1948],
	['即位礼正殿の儀', fixed(11, 12), 1990, 1990],
	['勤労感謝の日', fixed(11, 23), 1948],
	['天皇誕生日', fixed(12, 23), 1989, 2018]
];

function compute(year: number): Map<string, string> {
	const base = new Map<string, string>();
	for (const [name, date, from, to] of RULES) {
		if (year < from || (to !== undefined && year > to)) continue;
		base.set(date(year), name);
	}
	// 国民の休日: 祝日に挟まれた日（日曜・月曜は除く。月曜は振替休日になるため）
	if (year >= 1988) {
		for (const d of [...base.keys()]) {
			const next = shift(d, 1);
			const dow = weekday(next);
			if (base.has(shift(d, 2)) && !base.has(next) && dow !== 0 && dow !== 1) {
				base.set(next, '国民の休日');
			}
		}
	}
	// 振替休日: 日曜の祝日の後の、祝日でない最初の日。2007 年より前は翌日が祝日なら振り替えない
	const result = new Map(base);
	for (const d of base.keys()) {
		if (d < '1973-04-29' || weekday(d) !== 0) continue;
		let f = shift(d, 1);
		if (base.has(f)) {
			if (d < '2007-01-01') continue;
			while (base.has(f)) f = shift(f, 1);
		}
		result.set(f, '振替休日');
	}
	return new Map([...result].sort(([a], [b]) => (a < b ? -1 : 1)));
}

const cache = new Map<number, Map<string, string>>();

/** その年の祝日（'YYYY-MM-DD' → 名前）。日付順 */
export function holidaysOf(year: number): Map<string, string> {
	let m = cache.get(year);
	if (!m) cache.set(year, (m = compute(year)));
	return m;
}

/** 'YYYY-MM-DD' が祝日ならその名前 */
export function holidayName(date: string): string | undefined {
	return holidaysOf(Number(date.slice(0, 4))).get(date);
}
