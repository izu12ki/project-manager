import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken } from '#lib/mentions.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue, notification } from '../db/schema';
import { addComment, editComment, listComments } from '../services/comments';
import { createIssue, moveIssue, updateIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';

describe('services → notify', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor, other: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const got = async () =>
		(await db.select().from(notification))
			.map((n) => `${[member, guest, other].find((u) => u.id === n.userId)!.name}:${n.type}`)
			.sort();

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member', 'member');
		guest = await seedUser(db, 'guest', 'guest');
		other = await seedUser(db, 'member', 'other');
		await seedProject(db, { key: 'ACME', members: [member, guest, other] });
	});

	it('起票時に担当者を指定すると assigned', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
		expect(await got()).toEqual(['guest:assigned']);
	});

	it('担当とステータスを同時に変えると、新担当は assigned、他の関係者は status_changed', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await updateIssue(as(member), 'ACME', 1, { assigneeIds: [other.id], status: 'in_progress' });
		expect(await got()).toEqual(['guest:status_changed', 'other:assigned']);
	});

	it('担当者を足したときは、新しく担当になった人だけ assigned', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeIds: [guest.id] });
		await db.delete(notification);
		await updateIssue(as(member), 'ACME', 1, { assigneeIds: [guest.id, other.id] });
		expect(await got()).toEqual(['other:assigned']);
	});

	it('タイトルだけの変更では通知しない', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await updateIssue(as(member), 'ACME', 1, { title: 'B' });
		expect(await got()).toEqual([]);
	});

	it('説明の編集で増えたメンションだけ通知する', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', description: mentionToken(guest) });
		expect(await got()).toEqual(['guest:mentioned']);
		await updateIssue(as(member), 'ACME', 1, {
			description: `${mentionToken(guest)} ${mentionToken(other)}`
		});
		expect(await got()).toEqual(['guest:mentioned', 'other:mentioned']);
	});

	it('カンバンで列を移ると status_changed、同じ列の並び替えでは通知しない', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await createIssue(as(guest), 'ACME', { title: 'B' });
		const [a] = await db.select().from(issue);
		await moveIssue(as(member), 'ACME', {
			issueId: a.id,
			status: 'todo',
			beforeId: '',
			afterId: ''
		});
		expect(await got()).toEqual([]);
		await moveIssue(as(member), 'ACME', { issueId: a.id, status: 'done' });
		expect(await got()).toEqual(['guest:status_changed']);
	});

	it('コメントで関係者に commented、メンションされた人に mentioned', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await addComment(as(member), 'ACME', 1, { body: `${mentionToken(other)} お願いします` });
		expect(await got()).toEqual(['guest:commented', 'other:mentioned']);
	});

	it('コメントをメンションを変えずに編集しても再通知しない。増やせば増えた分だけ', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await addComment(as(member), 'ACME', 1, { body: mentionToken(other) });
		const [c] = await listComments(as(member), 'ACME', 1);
		await editComment(as(member), 'ACME', 1, c.id, { body: `${mentionToken(other)} 誤字修正` });
		expect(await got()).toEqual(['guest:commented', 'other:mentioned']);
		await editComment(as(member), 'ACME', 1, c.id, {
			body: `${mentionToken(other)} ${mentionToken(guest)}`
		});
		expect(await got()).toEqual(['guest:commented', 'guest:mentioned', 'other:mentioned']);
	});
});
