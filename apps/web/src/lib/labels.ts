/** プロジェクト作成時に用意する既定のステータス。todo（起票時の初期値）と done（完了）は削除できない */
export const DEFAULT_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
/** ステータスはプロジェクトごとに追加できるので、キーは任意の文字列 */
export type Status = string;
export const STATUS_LABEL: Record<string, string> = {
	todo: '未着手',
	in_progress: '進行中',
	in_review: 'レビュー',
	done: '完了'
};
export const INITIAL_STATUS = 'todo';
export const DONE_STATUS = 'done';
export const FIXED_STATUSES: readonly string[] = [INITIAL_STATUS, DONE_STATUS];

/** プロジェクトのステータス定義（表示順） */
export interface StatusDef {
	key: string;
	name: string;
	color: ColorName;
}

/** プロジェクト作成時に用意する既定の課題種別 */
export const DEFAULT_ISSUE_TYPES: { name: string; color: ColorName }[] = [
	{ name: 'タスク', color: 'blue' },
	{ name: 'バグ', color: 'pink' },
	{ name: '要望', color: 'teal' },
	{ name: 'その他', color: 'gray' }
];

export const RESOLUTIONS = [
	'fixed',
	'wont_fix',
	'invalid',
	'duplicate',
	'cannot_reproduce'
] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const RESOLUTION_LABEL: Record<Resolution, string> = {
	fixed: '対応済み',
	wont_fix: '対応しない',
	invalid: '無効',
	duplicate: '重複',
	cannot_reproduce: '再現しない'
};

/** ステータス・課題種別・プロジェクトに設定できる色（layout.css の --c-*） */
export const COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'pink'] as const;
export type ColorName = (typeof COLORS)[number];
export const COLOR_LABEL: Record<ColorName, string> = {
	gray: 'グレー',
	blue: '青',
	teal: '水色',
	green: '緑',
	amber: '黄',
	orange: 'オレンジ',
	pink: 'ピンク'
};
export const colorVar = (c: string | null | undefined): string =>
	COLORS.includes(c as ColorName) ? `var(--c-${c})` : 'var(--c-gray)';

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
	none: 'なし',
	low: '低',
	medium: '中',
	high: '高',
	urgent: '緊急'
};

/** ロールの選択肢の並び（権限が弱い順） */
export const ROLES = ['viewer', 'guest', 'member', 'admin'] as const;

export const ROLE_LABEL = {
	admin: '管理者',
	member: 'メンバー',
	guest: 'ゲスト',
	viewer: '閲覧者'
} as const;

export const DEFAULT_STATUS_COLOR: Record<(typeof DEFAULT_STATUSES)[number], ColorName> = {
	todo: 'gray',
	in_progress: 'blue',
	in_review: 'amber',
	done: 'green'
};

/** キーからステータスの表示名を引く。定義にないものは既定の名前で補う */
export function statusName(statuses: readonly StatusDef[] | undefined, key: string): string {
	return statuses?.find((s) => s.key === key)?.name ?? STATUS_LABEL[key] ?? '削除されたステータス';
}

export function statusColor(statuses: readonly StatusDef[] | undefined, key: string): string {
	const c =
		statuses?.find((s) => s.key === key)?.color ??
		DEFAULT_STATUS_COLOR[key as keyof typeof DEFAULT_STATUS_COLOR];
	return colorVar(c);
}

export const PRIORITY_CLASS: Record<Priority, string> = {
	none: 'pill-outline',
	low: 'pill-outline',
	medium: 'pill-mid',
	high: 'pill-tint',
	urgent: 'pill-urgent'
};

export const ROLE_CLASS = {
	admin: 'pill-admin',
	member: 'pill-tint',
	guest: 'pill-tint',
	viewer: 'pill-tint'
} as const;

export const ROLE_COLOR = {
	admin: 'var(--primary)',
	member: 'var(--c-teal)',
	guest: 'var(--c-pink)',
	viewer: 'var(--c-blue)'
} as const;

const PALETTE = [
	'var(--c-blue)',
	'var(--c-pink)',
	'var(--c-teal)',
	'var(--c-orange)',
	'var(--c-green)',
	'var(--c-amber)'
];

/** プロジェクトアイコンの色。未設定ならキーから選ぶ */
export function projectColor(p: { key: string; color: string | null }): string {
	return p.color ? colorVar(p.color) : colorFor(p.key);
}

/** プロジェクトアイコンの文字。未設定ならキーの頭文字 */
export function projectIcon(p: { key: string; icon: string | null }): string {
	return p.icon || p.key[0];
}

/** 名前やキーから安定した色を選ぶ（アバター・プロジェクトアイコン用） */
export function colorFor(seed: string | null | undefined): string {
	if (!seed) return 'var(--c-gray)';
	let h = 0;
	for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
	return PALETTE[h % PALETTE.length];
}

/** 'YYYY-MM-DD' の今日（Asia/Tokyo） */
export function todayJst(): string {
	return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/** 期限 'YYYY-MM-DD' → 'MM/DD'（未設定は '—'） */
export function formatDue(due: string | null | undefined): string {
	return due ? due.slice(5).replace('-', '/') : '—';
}

/** マイルストーンの表示名。リリース日があれば「v1.0（11/30 リリース）」 */
export function milestoneLabel(m: { name: string; releaseDate: string | null }): string {
	return m.releaseDate ? `${m.name}（${formatDue(m.releaseDate)} リリース）` : m.name;
}

export function isDueAlert(due: string | null | undefined, status: Status): boolean {
	return !!due && status !== DONE_STATUS && due <= todayJst();
}

export function formatDateTime(d: Date): string {
	return d.toLocaleString('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function formatDate(d: Date): string {
	return d.toLocaleDateString('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
}

export const ISSUE_CHANGE_FIELDS = [
	'title',
	'description',
	'type',
	'status',
	'resolution',
	'priority',
	'assignee',
	'parent',
	'category',
	'milestone',
	'startDate',
	'dueDate'
] as const;
export type IssueChangeField = (typeof ISSUE_CHANGE_FIELDS)[number];
/** from / to は変更時点の表示名（後で名前が変わったり削除されたりしても当時のまま出す）。本文は変更前後の全文 */
export type IssueChangeItem = { field: IssueChangeField; from: string | null; to: string | null };

export const ISSUE_CHANGE_FIELD_LABEL: Record<IssueChangeField, string> = {
	title: 'タイトル',
	description: '本文',
	type: '種別',
	status: 'ステータス',
	resolution: '完了理由',
	priority: '優先度',
	assignee: '担当者',
	parent: '親課題',
	category: 'カテゴリー',
	milestone: 'マイルストーン',
	startDate: '開始日',
	dueDate: '期限日'
};
