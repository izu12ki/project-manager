// issue_assignee（担当者の索引）を issue のトリガーが assignee_ids・status に合わせて書き直すことを確かめる。
// issue テーブルを作り直すマイグレーションでトリガーが消えると、ここが失敗する
import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import { createIssue, moveIssue, updateIssue } from '../services/issues';
import { removeMember } from '../services/projects';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import type { DB } from '.';
import { issue, issueAssignee } from './schema';

describe('issue_assignee', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, a: Actor, b: Actor, c: Actor;
	const as = (actor: Actor) => ctxOf(base, actor);
	/** 課題番号 1 の担当者の行（user_id の名前と、完了か） */
	const rows = async () => {
		const names = new Map([a, b, c].map((u) => [u.id, u.name]));
		const r = await db
			.select({ userId: issueAssignee.userId, done: issueAssignee.done })
			.from(issueAssignee)
			.innerJoin(issue, eq(issue.id, issueAssignee.issueId))
			.where(eq(issue.number, 1))
			.orderBy(asc(issueAssignee.userId));
		return r.map((x) => `${names.get(x.userId) ?? x.userId}${x.done ? ':done' : ''}`).sort();
	};

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		a = await seedUser(db, 'member', 'a');
		b = await seedUser(db, 'member', 'b');
		c = await seedUser(db, 'member', 'c');
		await seedProject(db, { key: 'ACME', members: [a, b, c] });
	});

	it('課題を作ると担当者ごとに 1 行でき、担当者を変えると書き直す', async () => {
		await createIssue(as(a), 'ACME', { title: 'x', assigneeIds: [a.id, b.id] });
		expect(await rows()).toEqual(['a', 'b']);

		await updateIssue(as(a), 'ACME', 1, { assigneeIds: [b.id, c.id] });
		expect(await rows()).toEqual(['b', 'c']);

		await updateIssue(as(a), 'ACME', 1, { assigneeIds: [] });
		expect(await rows()).toEqual([]);
	});

	it('完了にすると done になり、完了から戻すと外れる', async () => {
		await createIssue(as(a), 'ACME', { title: 'x', assigneeIds: [a.id] });
		await updateIssue(as(a), 'ACME', 1, { status: 'in_progress' });
		expect(await rows()).toEqual(['a']);

		await updateIssue(as(a), 'ACME', 1, { status: 'done', resolution: 'fixed' });
		expect(await rows()).toEqual(['a:done']);

		const [{ id }] = await db.select({ id: issue.id }).from(issue).where(eq(issue.number, 1));
		await moveIssue(as(a), 'ACME', { issueId: id, status: 'todo' });
		expect(await rows()).toEqual(['a']);

		await createIssue(as(a), 'ACME', { title: 'y', assigneeIds: [b.id], status: 'done' });
		const [{ done }] = await db
			.select({ done: issueAssignee.done })
			.from(issueAssignee)
			.where(eq(issueAssignee.userId, b.id));
		expect(done).toBe(true);
	});

	it('参加者を外すと、その人の行も消える', async () => {
		await createIssue(as(a), 'ACME', { title: 'x', assigneeIds: [a.id, b.id] });
		await removeMember(as(admin), 'ACME', b.id);
		expect(await rows()).toEqual(['a']);
	});

	it('assignee_ids に同じ ID が重なっていても書き込みは失敗しない', async () => {
		await createIssue(as(a), 'ACME', { title: 'x' });
		await db
			.update(issue)
			.set({ assigneeIds: sql`json_array(${a.id}, ${a.id})` })
			.where(eq(issue.number, 1));
		expect(await rows()).toEqual(['a']);
	});
});
