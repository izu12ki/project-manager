import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { comment, issue, notification, user } from '../db/schema';
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
