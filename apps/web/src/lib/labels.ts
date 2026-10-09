export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
	todo: '未着手',
	in_progress: '進行中',
	in_review: 'レビュー中',
	done: '完了'
};

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
	none: 'なし',
	low: '低',
	medium: '中',
	high: '高',
	urgent: '緊急'
};

export const ROLE_LABEL = { admin: '管理者', member: 'メンバー', guest: 'ゲスト' } as const;

export const STATUS_COLOR: Record<Status, string> = {
	todo: 'var(--c-gray)',
	in_progress: 'var(--c-blue)',
	in_review: 'var(--c-amber)',
	done: 'var(--c-green)'
};

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
	guest: 'pill-tint'
} as const;

export const ROLE_COLOR = {
	admin: 'var(--primary)',
	member: 'var(--c-teal)',
	guest: 'var(--c-pink)'
} as const;

const PALETTE = [
	'var(--c-blue)',
	'var(--c-pink)',
	'var(--c-teal)',
	'var(--c-orange)',
	'var(--c-green)',
	'var(--c-amber)'
];

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

export function isDueAlert(due: string | null | undefined, status: Status): boolean {
	return !!due && status !== 'done' && due <= todayJst();
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
