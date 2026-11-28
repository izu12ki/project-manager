// project_issue_count（プロジェクト・ステータスごとの課題の数）を issue のトリガーが保つことを確かめる。
// issue テーブルを作り直すマイグレーションでトリガーが消えると、ここが失敗する
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import { createIssue, deleteIssue, moveIssue, updateIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import type { DB } from '.';
import { issue, project, projectIssueCount } from './schema';

describe('project_issue_count', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor;
	const as = (actor: Actor) => ctxOf(base, actor);

	/** トリガーが保つ数と、課題を数えた数（どちらも 0 の行は除く） */
	async function counts() {
		const kept = await db
			.select({ key: project.key, status: projectIssueCount.status, n: projectIssueCount.n })
			.from(projectIssueCount)
			.innerJoin(project, eq(project.id, projectIssueCount.projectId));
		const real = await db
			.select({ key: project.key, status: issue.status, n: sql<number>`count(*)` })
			.from(issue)
			.innerJoin(project, eq(project.id, issue.projectId))
			.where(sql`${issue.deletedAt} is null`)
			.groupBy(project.key, issue.status);
		const fmt = (rows: { key: string; status: string; n: number }[]) =>
			rows
				.filter((r) => r.n !== 0)
				.map((r) => `${r.key}:${r.status}=${r.n}`)
				.sort();
		return { kept: fmt(kept), real: fmt(real) };
	}
	async function expectConsistent(expected: string[]) {
		const { kept, real } = await counts();
		expect(real).toEqual(expected);
		expect(kept).toEqual(real);
	}

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		await seedProject(db, { key: 'ACME' });
		await seedProject(db, { key: 'BETA', name: 'Beta' });
	});

	it('作成・ステータスの変更・カンバンの移動・削除に合わせて数が変わる', async () => {
		await createIssue(as(admin), 'ACME', { title: 'a' });
		await createIssue(as(admin), 'ACME', { title: 'b' });
		await createIssue(as(admin), 'ACME', { title: 'c', status: 'done' });
		await createIssue(as(admin), 'BETA', { title: 'd' });
		await expectConsistent(['ACME:done=1', 'ACME:todo=2', 'BETA:todo=1']);

		await updateIssue(as(admin), 'ACME', 1, { status: 'in_progress' });
		await expectConsistent(['ACME:done=1', 'ACME:in_progress=1', 'ACME:todo=1', 'BETA:todo=1']);

		const [{ id }] = await db.select({ id: issue.id }).from(issue).where(eq(issue.title, 'b'));
		await moveIssue(as(admin), 'ACME', { issueId: id, status: 'done' });
		await expectConsistent(['ACME:done=2', 'ACME:in_progress=1', 'BETA:todo=1']);

		// ステータス以外の変更では変わらない
		await updateIssue(as(admin), 'ACME', 1, { title: 'a2', priority: 'high' });
		await expectConsistent(['ACME:done=2', 'ACME:in_progress=1', 'BETA:todo=1']);

		await deleteIssue(as(admin), 'ACME', 3);
		await expectConsistent(['ACME:done=1', 'ACME:in_progress=1', 'BETA:todo=1']);
	});

	it('削除した課題を戻す・消す・ステータスを変えても、削除した課題は数えない', async () => {
		await createIssue(as(admin), 'ACME', { title: 'a' });
		await createIssue(as(admin), 'ACME', { title: 'b' });
		await deleteIssue(as(admin), 'ACME', 2);
		// 削除した課題のステータスが変わっても数えない
		await db.update(issue).set({ status: 'done' }).where(eq(issue.title, 'b'));
		await expectConsistent(['ACME:todo=1']);
		// 削除を取り消すと数える
		await db.update(issue).set({ deletedAt: null, deletedBy: null }).where(eq(issue.title, 'b'));
		await expectConsistent(['ACME:done=1', 'ACME:todo=1']);
		// 行ごと消すと減る
		await db.delete(issue).where(eq(issue.title, 'a'));
		await expectConsistent(['ACME:done=1']);
	});
});
