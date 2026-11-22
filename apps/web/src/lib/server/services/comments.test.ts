import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { eq } from 'drizzle-orm';
import { commentReaction, issue as issueTable } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, deleteComment, editComment, listComments, toggleReaction } from './comments';
import { createIssue, deleteIssue } from './issues';

describe('comments', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(member), 'ACME', { title: 'A' });
	});

	it('参加者は投稿でき、古い順に並ぶ', async () => {
		await addComment(as(guest), 'ACME', 1, { body: 'first' });
		await addComment(as(member), 'ACME', 1, { body: 'second' });
		const list = await listComments(as(member), 'ACME', 1);
		expect(list.map((c) => [c.body, c.authorName])).toEqual([
			['first', 'guest'],
			['second', 'member']
		]);
	});

	it('投稿・編集で課題の更新日時が進む。削除・リアクションでは進まない', async () => {
		const old = new Date(Date.UTC(2026, 0, 1));
		const reset = () =>
			db.update(issueTable).set({ updatedAt: old }).where(eq(issueTable.number, 1));
		const updatedAt = async () =>
			(await db.select().from(issueTable).where(eq(issueTable.number, 1)))[0].updatedAt;

		await reset();
		await addComment(as(guest), 'ACME', 1, { body: 'g' });
		expect((await updatedAt()).getTime()).toBeGreaterThan(old.getTime());
		const [c] = await listComments(as(guest), 'ACME', 1);

		await reset();
		await editComment(as(guest), 'ACME', 1, c.id, { body: 'g2' });
		expect((await updatedAt()).getTime()).toBeGreaterThan(old.getTime());

		await reset();
		await toggleReaction(as(member), 'ACME', 1, c.id, { emoji: '👍' });
		await deleteComment(as(guest), 'ACME', 1, c.id);
		expect(await updatedAt()).toEqual(old);
	});

	it('空のコメントは validation', async () => {
		await expect(addComment(as(guest), 'ACME', 1, { body: '   ' })).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('自分のコメントだけ編集・削除できる。admin は全部できる', async () => {
		await addComment(as(guest), 'ACME', 1, { body: 'g' });
		const [c] = await listComments(as(guest), 'ACME', 1);
		await expect(editComment(as(member), 'ACME', 1, c.id, { body: 'x' })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await editComment(as(guest), 'ACME', 1, c.id, { body: 'g2' });
		expect((await listComments(as(guest), 'ACME', 1))[0].body).toBe('g2');
		await deleteComment(as(admin), 'ACME', 1, c.id);
		expect(await listComments(as(guest), 'ACME', 1)).toHaveLength(0);
	});

	it('別の課題の ID を指定しても操作できない', async () => {
		await createIssue(as(member), 'ACME', { title: 'B' });
		await addComment(as(guest), 'ACME', 1, { body: 'g' });
		const [c] = await listComments(as(guest), 'ACME', 1);
		await expect(deleteComment(as(guest), 'ACME', 2, c.id)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	describe('リアクション', () => {
		let commentId: string;
		const reactionsOf = async () => (await listComments(as(member), 'ACME', 1))[0].reactions;
		beforeEach(async () => {
			await addComment(as(guest), 'ACME', 1, { body: 'g' });
			commentId = (await listComments(as(guest), 'ACME', 1))[0].id;
		});

		it('付けた人が絵文字ごとにまとまり、もう一度押すと外れる', async () => {
			await toggleReaction(as(member), 'ACME', 1, commentId, { emoji: '👍' });
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: '🎉' });
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: '👍' });
			expect((await reactionsOf()).map((r) => [r.emoji, r.users.map((u) => u.name)])).toEqual([
				['👍', ['member', 'guest']],
				['🎉', ['guest']]
			]);
			await toggleReaction(as(member), 'ACME', 1, commentId, { emoji: '👍' });
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: '🎉' });
			expect((await reactionsOf()).map((r) => [r.emoji, r.users.map((u) => u.name)])).toEqual([
				['👍', ['guest']]
			]);
		});

		it('決まった絵文字以外は validation', async () => {
			await expect(
				toggleReaction(as(member), 'ACME', 1, commentId, { emoji: '<b>' })
			).rejects.toMatchObject({ code: 'validation' });
		});

		it('別の課題のコメントには付けられない', async () => {
			await createIssue(as(member), 'ACME', { title: 'B' });
			await expect(
				toggleReaction(as(member), 'ACME', 2, commentId, { emoji: '👍' })
			).rejects.toMatchObject({ code: 'not_found' });
		});

		it('削除した課題では付けられない', async () => {
			await deleteIssue(as(member), 'ACME', 1);
			await expect(
				toggleReaction(as(member), 'ACME', 1, commentId, { emoji: '👍' })
			).rejects.toThrow();
		});

		it('コメントを消すとリアクションも消える', async () => {
			await toggleReaction(as(member), 'ACME', 1, commentId, { emoji: '👍' });
			await deleteComment(as(guest), 'ACME', 1, commentId);
			expect(await db.select().from(commentReaction)).toHaveLength(0);
		});
	});
});
