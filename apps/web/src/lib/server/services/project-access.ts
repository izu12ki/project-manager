// 画面 1 つ分の読み取りを 1 回の db.batch（D1 への 1 往復）にまとめるための部品。
// D1 は 1 往復ごとに CPU 時間がかかる（手元で 0.25〜0.4ms）ので、プロジェクトの ID を先に引いてから
// 次の問い合わせを送るのではなく、プロジェクトキーの副問い合わせで絞って同じ batch に入れる。
// アクセス権（参加者か管理者か）も同じ batch の 1 文で引いて確かめる
import { and, eq, sql, type Placeholder, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { cachedRead } from '../db/cached-read';
import { project, projectMember } from '../db/schema';
import { AppError } from '../errors';
import type { StatusDef } from '#lib/labels.ts';
import { issueTypesQuery, statusesQuery, type IssueTypeRow } from './issue-fields';
import type { ProjectRow } from './projects';

/**
 * プロジェクトで絞る条件。列（project_id など）を受け取り、そのプロジェクトの行に限る SQL を返す。
 * 列の代わりに式（索引を使わせない +project_id など）も渡せる
 */
export type ProjectCond = (col: SQLiteColumn | SQL) => SQL;

/** プロジェクトの ID で絞る */
export const byProjectId =
	(id: string): ProjectCond =>
	(col) =>
		sql`${col} = ${id}`;

/** プロジェクトの ID を引く副問い合わせ。key は cachedRead のプレースホルダーでもよい */
export function projectIdOf(db: DB, key: string | Placeholder) {
	return db.select({ id: project.id }).from(project).where(eq(project.key, key));
}

/**
 * プロジェクトのキーで絞る（ID を引く副問い合わせ）。ID を待たずに同じ batch に入れられる。
 * `in (副問い合わせ)` ではなく `=` で比べる（キーは一意なので結果は同じ）。`in` だと SQLite が
 * (project_id, …) のインデックスの順に読めず、上限（LIMIT）があってもプロジェクトの全課題を読んで並べ替える。
 * D1 は読んだ行数を数えるので（無料プランは 1 日 500 万行）、課題の多いプロジェクトで効く
 */
export function ofProject(db: DB, key: string | Placeholder): ProjectCond {
	const id = projectIdOf(db, key);
	return (col) => sql`${col} = ${id}`;
}

function accessQuery(db: DB, key: string | Placeholder, actorId: string | Placeholder) {
	return db
		.select({ project, memberId: projectMember.userId })
		.from(project)
		.leftJoin(
			projectMember,
			and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actorId))
		)
		.where(eq(project.key, key));
}

const cachedAccess = cachedRead(['key', 'actorId'], (db, p) => accessQuery(db, p.key, p.actorId));

/**
 * requireProject と同じ判定に使う行（プロジェクトと、その人が参加していればその人の ID）。結果は checkProjectAccess で確かめる。
 * ctx.readBatch 用（組み立てを使い回す。db/cached-read.ts）。レイアウトとページの両方で引いても、送るのは 1 回（db/read-batch.ts）
 */
export function projectAccessRead(ctx: AppContext, key: string) {
	return cachedAccess(ctx.db, { key, actorId: ctx.actor.id });
}

/** cachedByKey が作ったもの。query ごと */
const byKeyReads = new Map<unknown, unknown>();

/**
 * プロジェクトのキーだけで決まる文（query(db, ofProject(db, key)) の形）の、組み立てを使い回すもの。
 * 呼ぶと (db, key) => 文 を返す。ctx.readBatch 用（db/cached-read.ts）。
 * 同じ query なら、どこで呼んでも同じものを返す。ctx.readBatch は同じ組み立て・同じ値の文を 1 回だけ送るので
 * （db/read-batch.ts）、レイアウトとページが同じもの（ステータスなど）を引いても重ならない
 */
export function cachedByKey<Q>(query: (db: DB, of: ProjectCond) => Q): (db: DB, key: string) => Q {
	let read = byKeyReads.get(query) as ((db: DB, key: string) => Q) | undefined;
	if (!read) {
		const cached = cachedRead(['key'], (db, p) => query(db, ofProject(db, p.key)));
		read = (db, key) => cached(db, { key });
		byKeyReads.set(query, read);
	}
	return read;
}

const statusesByKey = cachedByKey(statusesQuery);
const issueTypesByKey = cachedByKey(issueTypesQuery);

/** projectAccessRead の結果を確かめる。無い・参加していない（管理者を除く）なら not_found */
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
	const [access, statuses, issueTypes] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		statusesByKey(ctx.db, key),
		issueTypesByKey(ctx.db, key)
	]);
	return { project: checkProjectAccess(ctx, access), statuses, issueTypes };
}
