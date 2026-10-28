import type { Priority, Status } from '$lib/labels';

/** services が notify に渡す出来事。ID と本文だけを持ち、名前の解決は notify が行う */
export type IssueEvent =
	| { kind: 'issue_created'; assigneeIds: string[]; priority: Priority; description: string }
	/** 新しく担当者になった人 */
	| { kind: 'assignees_added'; assigneeIds: string[] }
	| { kind: 'status_changed'; from: Status; to: Status }
	| { kind: 'commented'; commentId: string; body: string }
	/** 説明（commentId = null）またはコメントの編集。before/after の差分で増えたメンションだけ扱う */
	| { kind: 'mentions_added'; commentId: string | null; before: string; after: string };

export interface NotifyInput {
	project: { id: string; key: string; name: string };
	issue: { id: string; number: number; title: string };
	events: IssueEvent[];
}

/** 一括 API の更新。課題ごとの出来事を notifyBulk がまとめる */
export interface BulkNotifyInput {
	project: NotifyInput['project'];
	items: { issue: NotifyInput['issue']; events: IssueEvent[] }[];
}
