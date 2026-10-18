import { PRIORITY_LABEL, statusName, type Priority, type StatusDef } from '$lib/labels';
import type { IssueEvent } from '../events';
import { excerpt } from '../format';
import type { PlannedNotification } from '../recipients';
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

const VERB: Record<DirectMessage['type'], string> = {
	assigned: 'あなたを担当者に設定',
	mentioned: 'あなたを メンション',
	commented: 'コメント',
	status_changed: 'ステータスを変更'
};

export function headline(m: DirectMessage): string {
	return `${m.actor.name}さんが ${VERB[m.type]} しました。`;
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
