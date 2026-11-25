import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { findIssueByKey } from './issue-lookup';
import { createIssue } from './issues';

describe('findIssueByKey', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		outsider = await seedUser(db, 'member', 'outsider');
		await seedProject(db, { key: 'ACME', members: [member] });
		await seedProject(db, { key: 'NEW', members: [member] });
		for (const title of ['1', '2', '3']) await createIssue(as(admin), 'ACME', { title });
		await createIssue(as(admin), 'NEW', { title: 'Backlog の OLD-7' });
		// NEW-1 は Backlog の OLD-7、ACME-2 は Backlog の ACME-3 を取り込んだもの（番号がずれた）
		const [newIssue] = await db.select().from(issue).where(eq(issue.title, 'Backlog の OLD-7'));
		await db.update(issue).set({ backlogKey: 'OLD-7' }).where(eq(issue.id, newIssue.id));
		await db.update(issue).set({ backlogKey: 'ACME-3' }).where(eq(issue.title, '2'));
	});

	it('Backlog の元のキーを先に、なければこのツールのキーで探す', async () => {
		expect(await findIssueByKey(as(member), 'OLD-7')).toEqual({ projectKey: 'NEW', number: 1 });
		// ACME-3 は Backlog の ACME-3（今の ACME-2）を指す
		expect(await findIssueByKey(as(member), 'ACME-3')).toEqual({ projectKey: 'ACME', number: 2 });
		expect(await findIssueByKey(as(member), 'ACME-1')).toEqual({ projectKey: 'ACME', number: 1 });
		expect(await findIssueByKey(as(member), 'acme-01')).toEqual({ projectKey: 'ACME', number: 1 });
	});

	it('見つからない・見られない・形が違うときは null。管理者は参加していなくても見つかる', async () => {
		expect(await findIssueByKey(as(member), 'ACME-99')).toBeNull();
		expect(await findIssueByKey(as(outsider), 'ACME-1')).toBeNull();
		expect(await findIssueByKey(as(outsider), 'OLD-7')).toBeNull();
		expect(await findIssueByKey(as(admin), 'OLD-7')).toEqual({ projectKey: 'NEW', number: 1 });
		for (const bad of ['ACME', 'ACME-', '1-2', 'ACME-1-2', "ACME-1' or 1=1"]) {
			expect(await findIssueByKey(as(member), bad), bad).toBeNull();
		}
	});
});
