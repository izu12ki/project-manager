import { holidayName } from './holidays';
import { DONE_STATUS, type Status } from './labels';

/** タイムラインの日付計算・グループ化（DOM 非依存）。日付はすべて 'YYYY-MM-DD'、計算は UTC。 */

export const GROUPS = ['assignee', 'milestone', 'none'] as const;
export type GroupBy = (typeof GROUPS)[number];
export const SCALES = ['day', 'week'] as const;
export type Scale = (typeof SCALES)[number];

const DAY_MS = 86_400_000;

export function addDays(date: string, n: number): string {
	return new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** b - a（日数） */
export function diffDays(a: string, b: string): number {
	return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/** 0 = 日曜 */
export function weekday(date: string): number {
	return new Date(date).getUTCDay();
}

export function mondayOf(date: string): string {
	return addDays(date, -((weekday(date) + 6) % 7));
}

/** 土日か祝日 */
export function isOffDay(date: string): boolean {
	const d = weekday(date);
	return d === 0 || d === 6 || holidayName(date) !== undefined;
}

/** 'M/D' */
export function shortDate(date: string): string {
	return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

const SCALE_SPEC: Record<Scale, { days: number; dayWidth: number; step: number }> = {
	day: { days: 42, dayWidth: 32, step: 21 },
	week: { days: 182, dayWidth: 8, step: 91 }
};

export interface ViewRange {
	from: string;
	/** 最終日（含む） */
	to: string;
	days: number;
	/** 1 日の幅（px） */
	dayWidth: number;
	/** 前 / 次で動かす日数 */
	step: number;
}

/** 表示日数の上限。日付の誤入力で列が膨れすぎないようにする */
const MAX_DAYS = 731;

/** 既定の日数を基本に、until（最後の期限日など）が後ろにあればそこまで広げる */
export function viewRange(from: string, scale: Scale, until?: string | null): ViewRange {
	const s = SCALE_SPEC[scale];
	const need = until ? diffDays(from, until) + 1 : 0;
	const days = Math.max(s.days, Math.min(need, MAX_DAYS));
	return { from, to: addDays(from, days - 1), ...s, days };
}

/** 課題の中で最も遅い日付（期限、なければ開始日）。日付のある課題がなければ null */
export function lastDate(items: Dated[]): string | null {
	let last: string | null = null;
	for (const i of items) {
		const d = i.dueDate ?? i.startDate;
		if (d && (!last || d > last)) last = d;
	}
	return last;
}

/** 既定の表示開始日: 今日を含む週の月曜の 1 週間前 */
export function defaultFrom(today: string): string {
	return addDays(mondayOf(today), -7);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (s: string | null): s is string =>
	s !== null && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) && addDays(s, 0) === s;

/** '' は絞り込みなし。status の 'open' は完了以外、それ以外の 'none' は未設定 */
export interface TimelineFilters {
	status: '' | 'open' | Status;
	assignee: string;
	category: string;
	milestone: string;
}

export interface ViewParams {
	group: GroupBy;
	scale: Scale;
	from: string;
	filters: TimelineFilters;
}

/** getTimeline の引数。画面（+page.svelte）と load（+page.ts）で同じものを使う */
export function timelineArg(key: string, view: ViewParams) {
	return { key, from: view.from, ...view.filters };
}

/** URL クエリを読み、不正な値は既定に戻す */
export function parseView(q: URLSearchParams, today: string): ViewParams {
	const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
		all.includes(v as T) ? (v as T) : d;
	const from = q.get('from');
	return {
		group: pick(q.get('group'), GROUPS, 'assignee'),
		scale: pick(q.get('scale'), SCALES, 'day'),
		from: isValidDate(from) ? from : defaultFrom(today),
		filters: {
			status: q.get('status') ?? '',
			assignee: q.get('assignee') ?? '',
			category: q.get('category') ?? '',
			milestone: q.get('milestone') ?? ''
		}
	};
}

export interface Dated {
	startDate: string | null;
	dueDate: string | null;
}

export type BarSpan =
	| {
			kind: 'in';
			/** 0 始まりの列（両端を含む） */
			startCol: number;
			endCol: number;
			clippedStart: boolean;
			clippedEnd: boolean;
			missingStart: boolean;
			missingDue: boolean;
	  }
	| { kind: 'before' }
	| { kind: 'after' };

/** 表示範囲上のバーの位置。日付のない課題は null */
export function barSpan(item: Dated, range: ViewRange): BarSpan | null {
	const start = item.startDate ?? item.dueDate;
	const end = item.dueDate ?? item.startDate;
	if (!start || !end) return null;
	if (end < range.from) return { kind: 'before' };
	if (start > range.to) return { kind: 'after' };
	return {
		kind: 'in',
		startCol: Math.max(0, diffDays(range.from, start)),
		endCol: Math.min(range.days - 1, diffDays(range.from, end)),
		clippedStart: start < range.from,
		clippedEnd: end > range.to,
		missingStart: item.startDate === null,
		missingDue: item.dueDate === null
	};
}

export type DragMode = 'move' | 'start' | 'end';

/** クリックとみなすポインタの移動量（px）。これ未満は日付を変えない */
export const CLICK_SLOP = 4;

/**
 * 横方向の移動量 dx（px）を日数に丸める。クリックの許容量に半日分を足した距離を
 * 超えるまでは 0 日。正負で対称で、-0 は返さない。
 */
export function dragDelta(dx: number, dayWidth: number): number {
	const abs = Math.abs(dx);
	if (abs < CLICK_SLOP + dayWidth / 2) return 0;
	return Math.sign(dx) * Math.round(abs / dayWidth);
}

/**
 * ドラッグ後の日付。開始日 ≦ 期限を保つ。
 * - move: ある方の日付をすべて delta 日ずらす
 * - start: 左端。開始日（なければ期限を起点に新しく開始日）を動かす。期限を超えない
 * - end: 右端。期限（なければ開始日を起点に新しく期限）を動かす。開始日を下回らない
 */
export function applyDrag(item: Dated, mode: DragMode, delta: number): Dated {
	const { startDate: s, dueDate: d } = item;
	if (mode === 'move') {
		return { startDate: s && addDays(s, delta), dueDate: d && addDays(d, delta) };
	}
	if (mode === 'start') {
		const base = s ?? d;
		if (!base) return item;
		const next = addDays(base, delta);
		return { startDate: d && next > d ? d : next, dueDate: d };
	}
	const base = d ?? s;
	if (!base) return item;
	const next = addDays(base, delta);
	return { startDate: s, dueDate: s && next < s ? s : next };
}

export interface TimelineIssue extends Dated {
	id: string;
	number: number;
	status: Status;
	assignees: { id: string; name: string }[];
	milestoneId: string | null;
	milestoneName: string | null;
}

export interface MilestoneRef {
	id: string;
	name: string;
	releaseDate: string | null;
}

export interface IssueGroup<T> {
	key: string;
	/** group = 'none' のときは null（見出しを出さない） */
	label: string | null;
	releaseDate: string | null;
	done: number;
	total: number;
	items: T[];
}

const byStart = (a: TimelineIssue, b: TimelineIssue) => {
	const x = a.startDate ?? a.dueDate ?? '';
	const y = b.startDate ?? b.dueDate ?? '';
	return x < y ? -1 : x > y ? 1 : a.number - b.number;
};

/**
 * 担当者別・マイルストーン別・なし。「未割当」「マイルストーンなし」は最後。課題のないグループは出さない。
 * 担当者が複数いる課題は、それぞれの担当者のグループに出す
 */
export function groupItems<T extends TimelineIssue>(
	items: T[],
	by: GroupBy,
	milestones: MilestoneRef[]
): IssueGroup<T>[] {
	const sorted = [...items].sort(byStart);
	const make = (
		key: string,
		label: string | null,
		releaseDate: string | null,
		list: T[]
	): IssueGroup<T> => ({
		key,
		label,
		releaseDate,
		done: list.filter((i) => i.status === DONE_STATUS).length,
		total: list.length,
		items: list
	});
	if (by === 'none') return sorted.length ? [make('all', null, null, sorted)] : [];

	const buckets = new Map<string, T[]>();
	const names = new Map<string, string>();
	for (const i of sorted) {
		const keys =
			by === 'assignee'
				? i.assignees.length > 0
					? i.assignees.map((u) => (names.set(u.id, u.name), u.id))
					: ['none']
				: [i.milestoneId ?? 'none'];
		for (const k of keys) buckets.set(k, [...(buckets.get(k) ?? []), i]);
	}
	const release = new Map(milestones.map((m) => [m.id, m.releaseDate]));
	const groups = [...buckets].map(([k, list]) => {
		if (k === 'none') {
			return make(k, by === 'assignee' ? '未割当' : 'マイルストーンなし', null, list);
		}
		const label = (by === 'assignee' ? names.get(k) : list[0].milestoneName) ?? '';
		return make(k, label, by === 'milestone' ? (release.get(k) ?? null) : null, list);
	});
	return groups.sort((a, b) => {
		if (a.key === 'none' || b.key === 'none') return a.key === 'none' ? 1 : -1;
		if (by === 'milestone' && a.releaseDate !== b.releaseDate) {
			if (!a.releaseDate) return 1;
			if (!b.releaseDate) return -1;
			return a.releaseDate < b.releaseDate ? -1 : 1;
		}
		return a.label!.localeCompare(b.label!, 'ja');
	});
}

export interface DayCell {
	date: string;
	col: number;
	/** 月の 1 日か表示の初日 */
	monthStart: boolean;
	/** 土日・祝日 */
	off: boolean;
	holiday: string | undefined;
}

export function dayCells(range: ViewRange): DayCell[] {
	return Array.from({ length: range.days }, (_, col) => {
		const date = addDays(range.from, col);
		return {
			date,
			col,
			monthStart: col === 0 || date.endsWith('-01'),
			off: isOffDay(date),
			holiday: holidayName(date)
		};
	});
}
