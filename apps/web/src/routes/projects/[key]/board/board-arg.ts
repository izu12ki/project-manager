import type { BoardLimits } from '#lib/board-limits.ts';

/**
 * getBoard の引数。画面（+page.svelte）と load（+page.ts）で同じものを使う。
 * limits は列ごとに読み込むカードの数（下へスクロールして足した列だけ）。引数は文字列にしてキャッシュのキーになるので、
 * ステータスの順に並べて同じ中身なら同じキーにする
 */
export function boardArg(key: string, q: Pick<URLSearchParams, 'get'>, limits: BoardLimits = {}) {
	const sorted = Object.fromEntries(
		Object.entries(limits).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
	);
	return { key, milestone: q.get('milestone') ?? '', limits: sorted };
}
