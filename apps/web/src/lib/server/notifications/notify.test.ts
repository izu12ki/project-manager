import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { comment, issue, notification, projectWebhook, user } from '../db/schema';
import { createIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { notify, type NotifyInput } from '.';

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
		await db.update(issue).set({ assigneeId: member.id });
		await notify(as(admin), {
			...input,
			events: [{ kind: 'assignee_changed', assigneeId: member.id }]
		});
		expect(await rows()).toEqual([{ userId: member.id, type: 'assigned' }]);
	});

	it('担当を外したときは作らない', async () => {
		await notify(as(admin), { ...input, events: [{ kind: 'assignee_changed', assigneeId: null }] });
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
					assigneeId: guest.id,
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
			notify(broken, { ...input, events: [{ kind: 'assignee_changed', assigneeId: member.id }] })
		).resolves.toBeUndefined();
		expect(err).toHaveBeenCalled();
	});
});

describe('notify (webhook)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor;
	let input: Omit<NotifyInput, 'events'>;
	const as = (a: Actor) => ctxOf(base, a);
	const posted = async () => {
		await Promise.all(base.pending);
		return base.fetched.map((f) => (f.body as { text: string }).text);
	};

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		await db.insert(projectWebhook).values({
			id: uuidv7(),
			projectId: p.id,
			provider: 'slack',
			url: 'https://hooks.slack.com/services/T/B/X'
		});
		await createIssue(as(guest), 'ACME', { title: 'A' }); // issue_created が 1 件投稿される
		await Promise.all(base.pending);
		base.fetched.length = 0;
		base.pending.length = 0;
		const [i] = await db.select().from(issue);
		input = {
			project: { id: p.id, key: 'ACME', name: 'Acme' },
			issue: { id: i.id, number: 1, title: 'A' }
		};
	});

	it('出来事ごとに登録先へ順に投稿する', async () => {
		await notify(as(member), {
			...input,
			events: [
				{ kind: 'assignee_changed', assigneeId: guest.id },
				{ kind: 'status_changed', from: 'todo', to: 'done' }
			]
		});
		expect(await posted()).toEqual([
			'花子さんが 担当者を太郎さんに変更 しました。 ACME-1 A',
			'花子さんが ステータスを変更 しました。 ACME-1 A'
		]);
		expect(base.fetched[0].url).toBe('https://hooks.slack.com/services/T/B/X');
	});

	it('メンション追加は、増えた・受信できる・本人以外の人だけを並べ、いなければ投稿しない', async () => {
		await notify(as(member), {
			...input,
			events: [
				{
					kind: 'mentions_added',
					commentId: null,
					before: '',
					after: `${mentionToken(guest)} ${mentionToken(member)}`
				}
			]
		});
		expect(await posted()).toEqual(['花子さんが 太郎さんを メンション しました。 ACME-1 A']);
		base.fetched.length = 0;
		await notify(as(member), {
			...input,
			events: [
				{
					kind: 'mentions_added',
					commentId: null,
					before: mentionToken(guest),
					after: `${mentionToken(guest)} 誤字修正`
				}
			]
		});
		expect(await posted()).toEqual([]);
	});

	it('Webhook がなければ fetch しない', async () => {
		await db.delete(projectWebhook);
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		expect(await posted()).toEqual([]);
	});

	it('送信に失敗してもログだけ', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		base.fetch = async () => new Response('no', { status: 500 });
		await notify(as(member), {
			...input,
			events: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		await Promise.all(base.pending);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
	});
});
