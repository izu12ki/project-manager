/** getBoard の引数。画面（+page.svelte）と load（+page.ts）で同じものを使う */
export function boardArg(key: string, q: Pick<URLSearchParams, 'get'>) {
	return { key, milestone: q.get('milestone') ?? '' };
}
