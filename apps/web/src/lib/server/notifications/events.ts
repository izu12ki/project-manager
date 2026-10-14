import type { Priority, Status } from '$lib/labels';

/** services が notify に渡す出来事。ID と本文だけを持ち、名前の解決は notify が行う */
export type IssueEvent =
	| { kind: 'issue_created'; assigneeId: string | null; priority: Priority; description: string }
	| { kind: 'assignee_changed'; assigneeId: string | null }
	| { kind: 'status_changed'; from: Status; to: Status }
	| { kind: 'commented'; commentId: string; body: string }
	/** 説明（commentId = null）またはコメントの編集。before/after の差分で増えたメンションだけ扱う */
	| { kind: 'mentions_added'; commentId: string | null; before: string; after: string };

export interface NotifyInput {
	project: { id: string; key: string; name: string };
	issue: { id: string; number: number; title: string };
	events: IssueEvent[];
}
