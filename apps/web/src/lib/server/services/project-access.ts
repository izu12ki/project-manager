// 画面 1 つ分の読み取りを 1 回の db.batch（D1 への 1 往復）にまとめるための部品。
// D1 は 1 往復ごとに CPU 時間がかかる（手元で 0.25〜0.4ms）ので、プロジェクトの ID を先に引いてから
// 次の問い合わせを送るのではなく、プロジェクトキーの副問い合わせで絞って同じ batch に入れる。
// アクセス権（参加者か管理者か）も同じ batch の 1 文で引いて確かめる
import { and, eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { inList } from '../db/limits';
import { project, projectMember } from '../db/schema';
import { AppError } from '../errors';
import type { StatusDef } from '#lib/labels.ts';
import { issueTypesQuery, statusesQuery, type IssueTypeRow } from './issue-fields';
import type { ProjectRow } from './projects';

/** プロジェクトで絞る条件。列（project_id など）を受け取り、そのプロジェクトの行に限る SQL を返す */
export type ProjectCond = (col: SQLiteColumn) => SQL;

/** プロジェクトの ID で絞る */
export const byProjectId =
	(id: string): ProjectCond =>
	(col) =>
		eq(col, id);

/** プロジェクトのキーで絞る（ID を引く副問い合わせ）。ID を待たずに同じ batch に入れられる */
export function ofProject(db: DB, key: string): ProjectCond {
	const id = db.select({ id: project.id }).from(project).where(eq(project.key, key));
	return (col) => inList(col, id);
}

/** requireProject と同じ判定に使う行（プロジェクトと、その人が参加していればその人の ID） */
export function projectAccessQuery(ctx: AppContext, key: string) {
	return ctx.db
		.select({ project, memberId: projectMember.userId })
		.from(project)
		.leftJoin(
			projectMember,
			and(eq(projectMember.projectId, project.id), eq(projectMember.userId, ctx.actor.id))
		)
		.where(eq(project.key, key));
}

/** projectAccessQuery の結果を確かめる。無い・参加していない（管理者を除く）なら not_found */
export function checkProjectAccess(
	ctx: AppContext,
	rows: { project: ProjectRow; memberId: string | null }[]
): ProjectRow {
	const [row] = rows;
	if (!row || (ctx.actor.role !== 'admin' && !row.memberId)) {
		throw new AppError('not_found', 'プロジェクトが見つかりません');
	}
	return row.project;
}

/** プロジェクトの画面に共通のもの（レイアウト）。1 往復 */
export async function getProjectLayoutRows(
	ctx: AppContext,
	key: string
): Promise<{ project: ProjectRow; statuses: StatusDef[]; issueTypes: IssueTypeRow[] }> {
	const of = ofProject(ctx.db, key);
	const [access, statuses, issueTypes] = await ctx.db.batch([
		projectAccessQuery(ctx, key),
		statusesQuery(ctx.db, of),
		issueTypesQuery(ctx.db, of)
	]);
	return { project: checkProjectAccess(ctx, access), statuses, issueTypes };
}
