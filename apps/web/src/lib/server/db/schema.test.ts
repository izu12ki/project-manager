import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createIssue } from '$lib/server/services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '$lib/server/test-utils';
import { uuidv7 } from 'uuidv7';
import { comment, issue, notification, project, projectWebhook, user } from './schema';

describe('schema', () => {
	it('マイグレーションが適用され、課題削除でコメントが連鎖削除される', async () => {
		const db = await createTestDb();
		await db.insert(user).values({ id: 'u1', name: 'A', email: 'a@example.com', role: 'admin' });
		await db.insert(project).values({ id: 'p1', key: 'ACME', name: 'Acme' });
		await db.insert(issue).values({
			id: 'i1',
			projectId: 'p1',
			number: 1,
			title: 't',
			reporterId: 'u1',
			position: 'a0'
		});
		await db.insert(comment).values({ id: 'c1', issueId: 'i1', authorId: 'u1', body: 'hi' });

		await db.delete(issue).where(eq(issue.id, 'i1'));

		expect(await db.select().from(comment)).toHaveLength(0);
		const [p] = await db.select().from(project);
		expect(p.nextIssueNumber).toBe(1);
		expect(p.createdAt).toBeInstanceOf(Date);
	});

	it('同じプロジェクトで課題番号は重複できない', async () => {
		const db = await createTestDb();
		await db.insert(user).values({ id: 'u1', name: 'A', email: 'a@example.com', role: 'admin' });
		await db.insert(project).values({ id: 'p1', key: 'ACME', name: 'Acme' });
		const row = { projectId: 'p1', number: 1, title: 't', reporterId: 'u1', position: 'a0' };
		await db.insert(issue).values({ id: 'i1', ...row });
		await expect(db.insert(issue).values({ id: 'i2', ...row })).rejects.toThrow();
	});
});

describe('notification / project_webhook', () => {
	it('課題を消すと通知も消え、プロジェクトを消すと Webhook も消える', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const member = await seedUser(db, 'member');
		const p = await seedProject(db, { key: 'ACME', members: [member] });
		await createIssue(ctxOf(base, member), 'ACME', { title: 'A' });
		const [i] = await db.select().from(issue);
		await db.insert(notification).values({
			id: uuidv7(),
			userId: member.id,
			actorId: member.id,
			issueId: i.id,
			type: 'assigned'
		});
		await db.insert(projectWebhook).values({
			id: uuidv7(),
			projectId: p.id,
			provider: 'slack',
			url: 'https://hooks.slack.com/services/T/B/X'
		});
		await db.delete(issue);
		expect(await db.select().from(notification)).toHaveLength(0);
		await db.delete(project);
		expect(await db.select().from(projectWebhook)).toHaveLength(0);
	});
});
