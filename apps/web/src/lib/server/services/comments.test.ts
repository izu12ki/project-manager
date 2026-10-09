import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, deleteComment, editComment, listComments } from './comments';
import { createIssue } from './issues';

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
});
