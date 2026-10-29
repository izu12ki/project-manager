import type { Status } from '#lib/labels.ts';
import type { NotificationType } from '../db/schema';

export type Change =
	| { kind: 'assigned'; assigneeIds: string[] }
	| { kind: 'status_changed'; from: Status; to: Status }
	| { kind: 'commented'; commentId: string }
	| { kind: 'mentioned'; userIds: string[]; commentId: string | null };

/** 更新後の課題の関係者 */
export interface Participants {
	reporterId: string;
	assigneeIds: string[];
	commenterIds: string[];
}

export interface PlannedNotification {
	userId: string;
	type: NotificationType;
	commentId: string | null;
	fromStatus: Status | null;
	toStatus: Status | null;
}

const PRIORITY: Record<NotificationType, number> = {
	assigned: 3,
	mentioned: 2,
	commented: 1,
	status_changed: 1,
	// まとめ通知は notifyBulk が作る。planNotifications は出さない
	bulk_assigned: 0,
	bulk_mentioned: 0,
	bulk_updated: 0
};

/** 1 操作ぶんの変更から、受信者ごとに最も優先度の高い通知を 1 件ずつ決める */
export function planNotifications(input: {
	actorId: string;
	participants: Participants;
	changes: Change[];
	canReceive: (userId: string) => boolean;
}): PlannedNotification[] {
	const { actorId, participants: p, changes, canReceive } = input;
	const involved = [
		...new Set(
			[p.reporterId, ...p.assigneeIds, ...p.commenterIds].filter((id): id is string => !!id)
		)
	];
	const best = new Map<string, PlannedNotification>();
	const offer = (userId: string, n: Omit<PlannedNotification, 'userId'>) => {
		if (userId === actorId || !canReceive(userId)) return;
		const cur = best.get(userId);
		if (!cur || PRIORITY[n.type] > PRIORITY[cur.type]) best.set(userId, { userId, ...n });
	};
	const none = { commentId: null, fromStatus: null, toStatus: null };
	for (const c of changes) {
		switch (c.kind) {
			case 'assigned':
				for (const u of c.assigneeIds) offer(u, { ...none, type: 'assigned' });
				break;
			case 'status_changed':
				for (const u of involved)
					offer(u, { ...none, type: 'status_changed', fromStatus: c.from, toStatus: c.to });
				break;
			case 'commented':
				for (const u of involved) offer(u, { ...none, type: 'commented', commentId: c.commentId });
				break;
			case 'mentioned':
				for (const u of c.userIds) offer(u, { ...none, type: 'mentioned', commentId: c.commentId });
				break;
		}
	}
	return [...best.values()];
}
