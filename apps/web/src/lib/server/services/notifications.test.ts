import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { notification } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, listComments } from './comments';
import { createIssue, updateIssue } from './issues';
import {
	countUnread,
	listNotifications,
	markAllRead,
	markIssueRead,
	markRead
} from './notifications';
import { removeMember } from './projects';

describe('notifications service', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理');
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(guest), 'ACME', { title: 'ログイン' });
		await updateIssue(as(member), 'ACME', 1, { assigneeId: guest.id, status: 'in_progress' });
		await addComment(as(member), 'ACME', 1, { body: `${mentionToken(guest)} 確認お願いします` });
	});

	it('自分宛てを新しい順に、文面と遷移先付きで返す', async () => {
		const list = await listNotifications(as(guest));
		const [c] = await listComments(as(guest), 'ACME', 1);
		expect(list.map((n) => [n.type, n.summary, n.href])).toEqual([
			[
				'mentioned',
				'メンションしました: @太郎 確認お願いします',
				`/projects/ACME/issues/1#comment-${c.id}`
			],
			['assigned', '担当者に設定しました', '/projects/ACME/issues/1']
		]);
		expect(list[0]).toMatchObject({
			actorName: '花子',
			projectKey: 'ACME',
			issueNumber: 1,
			issueTitle: 'ログイン',
			read: false
		});
		expect(await listNotifications(as(member))).toEqual([]);
	});

	it('status_changed と commented と説明のメンションの文面', async () => {
		await updateIssue(as(guest), 'ACME', 1, { status: 'done' });
		await updateIssue(as(guest), 'ACME', 1, { description: mentionToken(member) });
		const summaries = (await listNotifications(as(member))).map((n) => n.summary);
		expect(summaries).toEqual(['説明でメンションしました', '進行中 → 完了']);
		await addComment(as(guest), 'ACME', 1, { body: 'a'.repeat(100) });
		expect((await listNotifications(as(member)))[0].summary).toBe(
			`コメントしました: ${'a'.repeat(80)}…`
		);
	});

	it('未読数と既読化', async () => {
		expect(await countUnread(as(guest))).toBe(2);
		const [first] = await listNotifications(as(guest));
		expect(await markRead(as(guest), first.id)).toEqual({ href: first.href });
		expect(await markRead(as(guest), first.id)).toEqual({ href: first.href }); // 2 回目も成功
		expect(await countUnread(as(guest))).toBe(1);
		await markAllRead(as(guest));
		expect(await countUnread(as(guest))).toBe(0);
		expect((await listNotifications(as(guest)))[0].read).toBe(true);
	});

	it('他人の通知は既読化できない（not_found）', async () => {
		const [n] = await db.select().from(notification).where(eq(notification.userId, guest.id));
		await expect(markRead(as(member), n.id)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('課題を開くとその課題の自分宛て未読が既読になる', async () => {
		await markIssueRead(as(guest), 'ACME', 1);
		expect(await countUnread(as(guest))).toBe(0);
	});

	it('プロジェクトから外れた人には、古い通知も見せない', async () => {
		await removeMember(as(admin), 'ACME', guest.id);
		expect(await listNotifications(as(guest))).toEqual([]);
		expect(await countUnread(as(guest))).toBe(0);
		const [n] = await db.select().from(notification).where(eq(notification.userId, guest.id));
		await expect(markRead(as(guest), n.id)).rejects.toMatchObject({ code: 'not_found' });
	});
});
