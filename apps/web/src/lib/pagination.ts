/** 課題一覧の 1 ページの件数。課題の多いプロジェクトでも、1 回の表示にかかる CPU 時間が増え続けないようにする */
export const ISSUE_PAGE_SIZE = 50;

/** URL の ?page= を読む。1 以上の整数でなければ 1 */
export function parsePage(params: URLSearchParams): number {
	const raw = params.get('page');
	if (!raw || !/^[1-9]\d{0,8}$/.test(raw)) return 1;
	return Number(raw);
}

/** 最後のページの番号。0 件でも 1 */
export function lastPage(total: number, size: number): number {
	return Math.max(1, Math.ceil(total / size));
}

/**
 * ページ送りに出す番号。先頭・末尾と、現在の前後 2 ページ。間が空くところは null（「…」を出す）。
 * 1 ページだけ空くところは「…」にせず、その番号を出す
 */
export function pageItems(current: number, last: number): (number | null)[] {
	const shown = new Set([1, last]);
	for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= last) shown.add(p);
	const sorted = [...shown].sort((a, b) => a - b);
	const items: (number | null)[] = [];
	for (const p of sorted) {
		const prev = items.at(-1);
		if (typeof prev === 'number' && p - prev === 2) items.push(p - 1);
		else if (typeof prev === 'number' && p - prev > 2) items.push(null);
		items.push(p);
	}
	return items;
}

/** ほかの条件を残したまま、ページだけを差し替えたクエリ文字列（先頭の ? 付き。空なら ''）。1 ページ目は page を付けない */
export function withPage(params: { toString(): string }, page: number): string {
	const next = new URLSearchParams(params.toString());
	if (page > 1) next.set('page', String(page));
	else next.delete('page');
	const s = next.toString();
	return s ? `?${s}` : '';
}
