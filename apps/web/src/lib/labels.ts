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
