import { PRIORITY_LABEL, statusName, type Priority, type StatusDef } from '$lib/labels';
import type { IssueEvent } from '../events';
import { excerpt } from '../format';
import type { PlannedNotification } from '../recipients';
import type { BulkType } from '../index';
import type { DirectMessage } from './types';

export interface DmSource {
	baseUrl: string;
	projectKey: string;
	issue: { number: number; title: string; priority: Priority };
	actorName: string;
	events: IssueEvent[];
	/** プロジェクトのステータス定義（名前の解決用） */
	statuses?: StatusDef[];
}

const VERB: Record<
	Exclude<DirectMessage['type'], 'bulk_assigned' | 'bulk_mentioned' | 'bulk_updated'>,
	string
> = {
	assigned: 'あなたを担当者に設定',
	mentioned: 'あなたを メンション',
	commented: 'コメント',
	status_changed: 'ステータスを変更'
};

export function headline(m: DirectMessage): string {
	switch (m.type) {
		case 'bulk_assigned':
			return `${m.actor.name}さんが ${m.issue.key} の ${m.count} 件の課題で あなたを担当者に設定しました。`;
		case 'bulk_mentioned':
			return `${m.actor.name}さんが ${m.issue.key} の ${m.count} 件の課題で あなたをメンションしました。`;
		case 'bulk_updated':
			return `${m.actor.name}さんが ${m.issue.key} の課題 ${m.count} 件を更新しました。`;
		default:
			return `${m.actor.name}さんが ${VERB[m.type]} しました。`;
	}
}

/** まとめ通知のリンク先（課題一覧。割り当ては受信者で絞り込む）。baseUrl を除いたパス */
export function bulkPath(projectKey: string, type: BulkType, userId: string): string {
	const path = `/projects/${projectKey}`;
	return type === 'bulk_assigned' ? `${path}?assignee=${encodeURIComponent(userId)}` : path;
}

export function bulkDirectMessage(
	src: { baseUrl: string; project: { key: string; name: string }; actorName: string },
	n: { userId: string; type: BulkType; count: number }
): DirectMessage {
	return {
		type: n.type,
		actor: { name: src.actorName },
		issue: {
			key: src.project.key,
			title: src.project.name,
			url: src.baseUrl + bulkPath(src.project.key, n.type, n.userId)
		},
		count: n.count,
		detail: ''
	};
}

/** commentId（null は説明）→ その本文 */
function texts(events: IssueEvent[]): Map<string | null, string> {
	const map = new Map<string | null, string>();
	for (const e of events) {
		if (e.kind === 'commented') map.set(e.commentId, e.body);
		else if (e.kind === 'mentions_added') map.set(e.commentId, e.after);
		else if (e.kind === 'issue_created') map.set(null, e.description);
	}
	return map;
}

export function toDirectMessage(src: DmSource, n: PlannedNotification): DirectMessage {
	const base = `${src.baseUrl}/projects/${src.projectKey}/issues/${src.issue.number}`;
	let detail = '';
	switch (n.type) {
		case 'assigned':
			detail = `優先度: ${PRIORITY_LABEL[src.issue.priority]}`;
			break;
		case 'status_changed':
			if (n.fromStatus && n.toStatus)
				detail = `${statusName(src.statuses, n.fromStatus)} → ${statusName(src.statuses, n.toStatus)}`;
			break;
		case 'commented':
		case 'mentioned':
			detail = excerpt(texts(src.events).get(n.commentId) ?? '', 200);
			break;
	}
	return {
		type: n.type,
		actor: { name: src.actorName },
		issue: {
			key: `${src.projectKey}-${src.issue.number}`,
			title: src.issue.title,
			url: n.commentId ? `${base}#comment-${n.commentId}` : base
		},
		detail
	};
}
