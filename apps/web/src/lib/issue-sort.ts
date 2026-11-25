/** 課題一覧の並べ替え。URL の ?sort=start&order=asc で表し、既定（キーの降順）のときは付けない */
export const ISSUE_SORT_KEYS = ['number', 'start', 'due', 'created', 'updated'] as const;
export type IssueSortKey = (typeof ISSUE_SORT_KEYS)[number];
export type SortOrder = 'asc' | 'desc';
export interface IssueSort {
	key: IssueSortKey;
	order: SortOrder;
}

export const DEFAULT_ISSUE_SORT: IssueSort = { key: 'number', order: 'desc' };

/** 列を初めて押したときの向き。予定の日付（開始日・期限）は近い順、記録の日時（登録日・更新日）は新しい順 */
const FIRST_ORDER: Record<IssueSortKey, SortOrder> = {
	number: 'desc',
	start: 'asc',
	due: 'asc',
	created: 'desc',
	updated: 'desc'
};

/** 不正な値は既定の並びとして扱う */
export function parseIssueSort(params: URLSearchParams): IssueSort {
	const key = params.get('sort');
	if (!ISSUE_SORT_KEYS.includes(key as IssueSortKey)) return DEFAULT_ISSUE_SORT;
	const order = params.get('order');
	return {
		key: key as IssueSortKey,
		order: order === 'asc' || order === 'desc' ? order : FIRST_ORDER[key as IssueSortKey]
	};
}

/** 列見出しを押した後の並び。同じ列なら向きを反転し、別の列ならその列の最初の向きにする */
export function nextIssueSort(current: IssueSort, key: IssueSortKey): IssueSort {
	if (current.key !== key) return { key, order: FIRST_ORDER[key] };
	return { key, order: current.order === 'asc' ? 'desc' : 'asc' };
}

export function isDefaultIssueSort(sort: IssueSort): boolean {
	return sort.key === DEFAULT_ISSUE_SORT.key && sort.order === DEFAULT_ISSUE_SORT.order;
}

/**
 * 絞り込みの条件を残したまま、並びだけを差し替えたクエリ文字列（先頭の ? 付き。空なら ''）。
 * 並びが変わると何ページ目かの意味も変わるので、ページは 1 ページ目に戻す
 */
export function withIssueSort(params: { toString(): string }, sort: IssueSort): string {
	const next = new URLSearchParams(params.toString());
	next.delete('page');
	next.delete('sort');
	next.delete('order');
	if (!isDefaultIssueSort(sort)) {
		next.set('sort', sort.key);
		next.set('order', sort.order);
	}
	const s = next.toString();
	return s ? `?${s}` : '';
}
