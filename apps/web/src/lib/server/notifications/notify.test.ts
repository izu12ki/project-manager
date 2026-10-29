import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionToken } from '#lib/mentions.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { comment, issue, notification, user, userIntegration } from '../db/schema';
import { createIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { notify, notifyBulk, type NotifyInput } from '.';

describe('notify (in-app)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	let input: Omit<NotifyInput, 'events'>;
	const as = (a: Actor) => ctxOf(base, a);
	const rows = () =>
		db.select({ userId: notification.userId, type: notification.type }).from(notification);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(guest), 'ACME', { title: 'A' });
		const [i] = await db.select().from(issue);
		input = {
			project: { id: p.id, key: 'ACME', name: 'Acme' },
			issue: { id: i.id, number: 1, title: 'A' }
		};
	});
	afterEach(() => vi.restoreAllMocks());

	it('担当者の変更で新しい担当者に assigned', async () => {
		await db.update(issue).set({ assigneeIds: [member.id] });
		await notify(as(admin), {
			...input,
			events: [{ kind: 'assignees_added', assigneeIds: [member.id] }]
		});
		expect(await rows()).toEqual([{ userId: member.id, type: 'assigned' }]);
	});

	it('担当を外したときは作らない', async () => {
		await notify(as(admin), { ...input, events: [{ kind: 'assignees_added', assigneeIds: [] }] });
		expect(await rows()).toEqual([]);
	});

	it('コメントは関係者（起票者・コメントした人）に commented、本文のメンションは mentioned', async () => {
		await db
			.insert(comment)
			.values({ id: 'c0', issueId: input.issue.id, authorId: admin.id, body: 'x' });
		const body = `${mentionToken(member)} 見てください`;
		await db
			.insert(comment)
			.values({ id: 'c1', issueId: input.issue.id, authorId: admin.id, body });
		await notify(as(admin), { ...input, events: [{ kind: 'commented', commentId: 'c1', body }] });
		const got = (await rows())
			.map((r) => `${r.userId === guest.id ? 'guest' : 'member'}:${r.type}`)
			.sort();
		expect(got).toEqual(['guest:commented', 'member:mentioned']);
	});

	it('アクセスできない人・無効化された人へのメンションは無視する', async () => {
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, member.id));
		const body = `${mentionToken(outsider)} ${mentionToken(member)}`;
		await notify(as(admin), {
			...input,
			events: [{ kind: 'mentions_added', commentId: null, before: '', after: body }]
		});
		expect(await rows()).toEqual([]);
	});

	it('mentions_added は増えた人だけ', async () => {
		const before = mentionToken(member);
		const after = `${mentionToken(member)} ${mentionToken(admin)}`;
		await notify(as(guest), {
			...input,
			events: [{ kind: 'mentions_added', commentId: null, before, after }]
		});
		expect(await rows()).toEqual([{ userId: admin.id, type: 'mentioned' }]);
	});

	it('issue_created は担当者に assigned、説明のメンションに mentioned', async () => {
		await notify(as(member), {
			...input,
			events: [
				{
					kind: 'issue_created',
					assigneeIds: [guest.id],
					priority: 'none',
					description: mentionToken(admin)
				}
			]
		});
		const got = await rows();
		expect(got).toContainEqual({ userId: guest.id, type: 'assigned' });
		expect(got).toContainEqual({ userId: admin.id, type: 'mentioned' });
	});

	it('内部で失敗しても例外を投げずにログする', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = {
			...as(admin),
			db: {
				select: () => {
					throw new Error('boom');
				}
			} as unknown as DB
		};
		await expect(
			notify(broken, { ...input, events: [{ kind: 'assignees_added', assigneeIds: [member.id] }] })
		).resolves.toBeUndefined();
		expect(err).toHaveBeenCalled();
	});
});

describe('notify (slack dm)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor, admin: Actor;
	let input: Omit<NotifyInput, 'events'>;
	const as = (a: Actor) => ctxOf(base, a);
	const sent = async () => {
		await Promise.all(base.pending);
		return base.fetched
			.filter((f) => f.url.endsWith('chat.postMessage'))
			.map((f) => {
				const b = f.body as { channel: string; text: string };
				return `${b.channel}:${b.text}`;
			})
			.sort();
	};

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db, { slackBotToken: 'xoxb-t' });
		admin = await seedUser(db, 'admin', '管理');
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await Promise.all(base.pending);
		base.fetched.length = 0;
		base.pending.length = 0;
		const [i] = await db.select().from(issue);
		input = {
			project: { id: p.id, key: 'ACME', name: 'Acme' },
			issue: { id: i.id, number: 1, title: 'A' }
		};
		await db.insert(userIntegration).values([
			{ userId: member.id, provider: 'slack', externalId: 'U_MEMBER' },
			{ userId: guest.id, provider: 'slack', externalId: 'U_GUEST' }
		]);
	});

	it('アプリ内通知の受信者のうち、オンにしている人にだけ送る（本人には送らない）', async () => {
		await db.update(issue).set({ assigneeIds: [member.id] });
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		// 起票者 guest にだけ届く。操作した member には届かない
		expect(await sent()).toEqual(['U_GUEST:花子さんが ステータスを変更 しました。 ACME-1 A']);
	});

	it('オンにしていない受信者には送らない', async () => {
		await db.delete(userIntegration);
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		expect(await sent()).toEqual([]);
		expect(await db.select().from(notification)).toHaveLength(1);
	});

	it('コメント＋メンションは 1 人 1 通（mentioned を優先）', async () => {
		const body = `${mentionToken(guest)} 見てください`;
		await db
			.insert(comment)
			.values({ id: 'c1', issueId: input.issue.id, authorId: admin.id, body });
		await notify(as(admin), { ...input, events: [{ kind: 'commented', commentId: 'c1', body }] });
		expect(await sent()).toEqual(['U_GUEST:管理さんが あなたを メンション しました。 ACME-1 A']);
		const dm = base.fetched.find((f) => f.url.endsWith('chat.postMessage'))!.body as {
			blocks: { text?: { text: string } }[];
		};
		expect(dm.blocks[0].text!.text).toContain('/projects/ACME/issues/1#comment-c1');
	});

	it('担当になった通知の 2 行目は優先度', async () => {
		await db.update(issue).set({ assigneeIds: [member.id], priority: 'high' });
		await notify(as(admin), {
			...input,
			events: [{ kind: 'assignees_added', assigneeIds: [member.id] }]
		});
		const dm = base.fetched.find((f) => f.url.endsWith('chat.postMessage'))!.body as {
			channel: string;
			blocks: { elements?: { text: string }[] }[];
		};
		expect(dm.channel).toBe('U_MEMBER');
		expect(dm.blocks[1].elements![0].text).toBe('優先度: 高');
	});

	it('トークン未設定なら送らない（アプリ内通知は作る）', async () => {
		base.slackBotToken = null;
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		expect(await sent()).toEqual([]);
		expect(await db.select().from(notification)).toHaveLength(1);
	});

	it('送信に失敗してもログだけで、アプリ内通知は残る', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		base.fetch = async () =>
			new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }));
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		await Promise.all(base.pending);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('channel_not_found'));
		expect(await db.select().from(notification)).toHaveLength(1);
	});
});

describe('notifyBulk', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	let project: NotifyInput['project'];
	let issues: NotifyInput['issue'][];
	const as = (a: Actor) => ctxOf(base, a);
	const rows = () =>
		db
			.select({
				userId: notification.userId,
				type: notification.type,
				count: notification.count,
				projectId: notification.projectId,
				issueId: notification.issueId
			})
			.from(notification);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db, { slackBotToken: 'xoxb-t' });
		admin = await seedUser(db, 'admin', '管理');
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		project = { id: p.id, key: 'ACME', name: 'Acme' };
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await createIssue(as(guest), 'ACME', { title: 'B' });
		await Promise.all(base.pending);
		base.fetched.length = 0;
		base.pending.length = 0;
		issues = (await db.select().from(issue)).map((i) => ({
			id: i.id,
			number: i.number,
			title: i.title
		}));
	});
	afterEach(() => vi.restoreAllMocks());

	it('受信者ごとに 1 件。メンションだけの人は bulk_mentioned（count = メンションされた課題数）', async () => {
		const after = mentionToken(member);
		await notifyBulk(as(admin), {
			project,
			items: issues.map((i) => ({
				issue: i,
				events: [{ kind: 'mentions_added', commentId: null, before: '', after }]
			}))
		});
		expect(await rows()).toEqual([
			{ userId: member.id, type: 'bulk_mentioned', count: 2, projectId: project.id, issueId: null }
		]);
	});

	it('担当にもメンションにもなった人は bulk_assigned だけ（count = 担当にした課題数）', async () => {
		const after = mentionToken(member);
		await notifyBulk(as(admin), {
			project,
			items: [
				{
					issue: issues[0],
					events: [
						{ kind: 'assignees_added', assigneeIds: [member.id] },
						{ kind: 'mentions_added', commentId: null, before: '', after }
					]
				},
				{
					issue: issues[1],
					events: [{ kind: 'mentions_added', commentId: null, before: '', after }]
				}
			]
		});
		expect(await rows()).toEqual([
			{ userId: member.id, type: 'bulk_assigned', count: 1, projectId: project.id, issueId: null }
		]);
	});

	it('受信者がいなければ何も書かず、送らない', async () => {
		await notifyBulk(as(admin), {
			project,
			items: issues.map((i) => ({
				issue: i,
				events: [{ kind: 'assignees_added', assigneeIds: [] }]
			}))
		});
		expect(await rows()).toEqual([]);
		expect(base.fetched).toEqual([]);
	});

	it('Slack DM は受信者ごとに 1 通で、リンクはプロジェクトの課題一覧', async () => {
		await db.insert(userIntegration).values([
			{ userId: member.id, provider: 'slack', externalId: 'U_MEMBER' },
			{ userId: guest.id, provider: 'slack', externalId: 'U_GUEST' }
		]);
		await db.update(issue).set({ assigneeIds: [member.id] });
		await notifyBulk(as(admin), {
			project,
			items: issues.map((i) => ({
				issue: i,
				events: [
					{ kind: 'assignees_added', assigneeIds: [member.id] },
					{ kind: 'status_changed', from: 'todo', to: 'done' }
				]
			}))
		});
		await Promise.all(base.pending);
		const posts = base.fetched
			.filter((f) => f.url.endsWith('chat.postMessage'))
			.map(
				(f) => f.body as { channel: string; text: string; blocks: { text?: { text: string } }[] }
			)
			.sort((a, b) => a.channel.localeCompare(b.channel));
		expect(posts.map((p) => `${p.channel}:${p.text}`)).toEqual([
			'U_GUEST:管理さんが ACME の課題 2 件を更新しました。 ACME Acme',
			'U_MEMBER:管理さんが ACME の 2 件の課題で あなたを担当者に設定しました。 ACME Acme'
		]);
		expect(posts[0].blocks[0].text!.text).toContain('http://localhost:5173/projects/ACME|');
		expect(posts[1].blocks[0].text!.text).toContain(
			`http://localhost:5173/projects/ACME?assignee=${member.id}|`
		);
	});

	it('内部で失敗しても例外を投げずにログする', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = {
			...as(admin),
			db: {
				select: () => {
					throw new Error('boom');
				}
			} as unknown as DB
		};
		await expect(
			notifyBulk(broken, {
				project,
				items: [
					{ issue: issues[0], events: [{ kind: 'assignees_added', assigneeIds: [member.id] }] }
				]
			})
		).resolves.toBeUndefined();
		expect(err).toHaveBeenCalled();
	});
});
