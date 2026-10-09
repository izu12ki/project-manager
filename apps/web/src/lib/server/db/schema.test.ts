import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '$lib/server/test-utils';
import { comment, issue, project, user } from './schema';

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
