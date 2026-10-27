import { describe, expect, it } from 'vitest';
import { planNotifications, type Change, type Participants } from './recipients';

const P: Participants = { reporterId: 'r', assigneeIds: ['a'], commenterIds: ['c1', 'c2'] };
const all = () => true;
const plan = (
	changes: Change[],
	opts: Partial<{
		actorId: string;
		participants: Participants;
		canReceive: (id: string) => boolean;
	}> = {}
) =>
	planNotifications({ actorId: 'x', participants: P, canReceive: all, changes, ...opts })
		.map((n) => `${n.userId}:${n.type}`)
		.sort();

describe('planNotifications', () => {
	it('担当者の設定は新しく担当になった人だけに assigned', () => {
		expect(plan([{ kind: 'assigned', assigneeIds: ['a'] }])).toEqual(['a:assigned']);
	});
	it('複数の担当者が増えたら、それぞれに assigned', () => {
		expect(plan([{ kind: 'assigned', assigneeIds: ['a', 'b'] }])).toEqual([
			'a:assigned',
			'b:assigned'
		]);
	});
	it('コメントは関係者全員（起票者・担当者・コメントした人）に commented', () => {
		expect(plan([{ kind: 'commented', commentId: 'k' }])).toEqual([
			'a:commented',
			'c1:commented',
			'c2:commented',
			'r:commented'
		]);
	});
	it('ステータス変更は関係者全員に status_changed（from/to 付き）', () => {
		const out = planNotifications({
			actorId: 'x',
			participants: P,
			canReceive: all,
			changes: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		expect(out).toHaveLength(4);
		expect(out[0]).toMatchObject({
			type: 'status_changed',
			fromStatus: 'todo',
			toStatus: 'done',
			commentId: null
		});
	});
	it('操作した本人には送らない', () => {
		expect(plan([{ kind: 'commented', commentId: 'k' }], { actorId: 'c1' })).not.toContain(
			'c1:commented'
		);
		expect(plan([{ kind: 'assigned', assigneeIds: ['x'] }])).toEqual([]);
	});
	it('受信できない人（無効化・非参加）には送らない', () => {
		expect(
			plan([{ kind: 'commented', commentId: 'k' }], { canReceive: (id) => id !== 'r' })
		).not.toContain('r:commented');
	});
	it('1 人 1 件。assigned > mentioned > commented / status_changed', () => {
		expect(
			plan([
				{ kind: 'assigned', assigneeIds: ['a'] },
				{ kind: 'status_changed', from: 'todo', to: 'in_progress' }
			])
		).toEqual(['a:assigned', 'c1:status_changed', 'c2:status_changed', 'r:status_changed']);
		expect(
			plan([
				{ kind: 'commented', commentId: 'k' },
				{ kind: 'mentioned', userIds: ['r', 'm'], commentId: 'k' }
			])
		).toEqual(['a:commented', 'c1:commented', 'c2:commented', 'm:mentioned', 'r:mentioned']);
	});
	it('mentioned はコメント ID を引き継ぐ。説明のメンションは null', () => {
		const [n] = planNotifications({
			actorId: 'x',
			participants: P,
			canReceive: all,
			changes: [{ kind: 'mentioned', userIds: ['m'], commentId: null }]
		});
		expect(n).toMatchObject({ userId: 'm', type: 'mentioned', commentId: null });
	});
	it('担当者なし・コメントなしでも動く', () => {
		expect(
			plan([{ kind: 'commented', commentId: 'k' }], {
				participants: { reporterId: 'r', assigneeIds: [], commenterIds: [] }
			})
		).toEqual(['r:commented']);
	});
});
