import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken } from '#lib/mentions.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { notification } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, listComments } from './comments';
import { bulkCreateIssues } from './issue-bulk';
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
		await updateIssue(as(member), 'ACME', 1, { assigneeIds: [guest.id], status: 'in_progress' });
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
	describe('まとめ通知', () => {
		beforeEach(async () => {
			await bulkCreateIssues(
				as(admin),
				'ACME',
				{
					items: [
						{ title: 'X', assigneeIds: [member.id] },
						{ title: 'Y', assigneeIds: [member.id] }
					]
				},
				{ dryRun: false }
			);
		});

		it('一覧では件数の要約と、自分で絞り込んだ課題一覧へのリンクを返す', async () => {
			const [n] = await listNotifications(as(member));
			expect(n).toMatchObject({
				type: 'bulk_assigned',
				summary: '2 件の課題であなたを担当者に設定しました',
				actorName: '管理',
				projectKey: 'ACME',
				issueNumber: null,
				issueTitle: null,
				count: 2,
				href: `/projects/ACME?assignee=${member.id}`,
				read: false
			});
		});

		it('markRead でまとめ通知を既読にすると、href が課題一覧の URL', async () => {
			const [n] = await listNotifications(as(member));
			expect(await markRead(as(member), n.id)).toEqual({
				href: `/projects/ACME?assignee=${member.id}`
			});
			expect(await countUnread(as(member))).toBe(0);
		});

		it('bulk_mentioned の要約とリンク', async () => {
			await db
				.update(notification)
				.set({ type: 'bulk_mentioned', count: 4 })
				.where(eq(notification.userId, member.id));
			const [n] = await listNotifications(as(member));
			expect(n.summary).toBe('4 件の課題であなたをメンションしました');
			expect(n.href).toBe('/projects/ACME');
		});

		it('bulk_updated の要約とリンク', async () => {
			await db
				.update(notification)
				.set({ type: 'bulk_updated', count: 3 })
				.where(eq(notification.userId, member.id));
			const [n] = await listNotifications(as(member));
			expect(n.summary).toBe('3 件の課題を更新しました');
			expect(n.href).toBe('/projects/ACME');
		});

		it('member は、自分が参加していないプロジェクトのまとめ通知を listNotifications で見られず、countUnread にも数えない', async () => {
			expect(await countUnread(as(member))).toBe(1);
			await removeMember(as(admin), 'ACME', member.id);
			expect(await listNotifications(as(member))).toEqual([]);
			expect(await countUnread(as(member))).toBe(0);
			const [n] = await db.select().from(notification).where(eq(notification.userId, member.id));
			await expect(markRead(as(member), n.id)).rejects.toMatchObject({ code: 'not_found' });
		});
	});
});
