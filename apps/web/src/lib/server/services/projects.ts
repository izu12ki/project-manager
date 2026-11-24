import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { inList } from '../db/limits';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { COLORS, DONE_STATUS } from '#lib/labels.ts';
import { PROJECT_KEY_PATTERN, PROJECT_KEY_RULE } from '#lib/project-key.ts';
import { issue, project, projectMember, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';
import { defaultFieldInserts } from './issue-fields';
import { byProjectId, type ProjectCond } from './project-access';

export type ProjectRow = typeof project.$inferSelect;

const KeySchema = v.pipe(
	v.string(),
	v.trim(),
	v.toUpperCase(),
	v.regex(new RegExp(`^${PROJECT_KEY_PATTERN}$`), `キーは${PROJECT_KEY_RULE}で入力してください`)
);
const ProjectNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'プロジェクト名を入力してください'),
	v.maxLength(100, 'プロジェクト名は100文字以内で入力してください')
);
const DescriptionSchema = v.optional(v.pipe(v.string(), v.maxLength(10_000)), '');
/** 絵文字 1 つや 2 文字程度の略称を想定。空はキーの頭文字 */
const IconSchema = v.optional(
	v.pipe(
		v.string(),
		v.trim(),
		v.check(
			(s) => Array.from(new Intl.Segmenter().segment(s)).length <= 2,
			'アイコンは2文字以内で入力してください'
		)
	),
	''
);
/** '' は自動 */
const ColorSchema = v.optional(
	v.union([v.literal(''), v.picklist(COLORS)], '色を選択してください'),
	''
);

/** 見られるプロジェクト（名前順）。全画面のレイアウトで引くので、同時の読み取りとまとめて送る（ctx.readBatch） */
export async function listProjects(ctx: AppContext): Promise<ProjectRow[]> {
	if (ctx.actor.role === 'admin') {
		const [rows] = await ctx.readBatch([ctx.db.select().from(project).orderBy(asc(project.name))]);
		return rows;
	}
	const [rows] = await ctx.readBatch([
		ctx.db
			.select({ project })
			.from(project)
			.innerJoin(projectMember, eq(projectMember.projectId, project.id))
			.where(eq(projectMember.userId, ctx.actor.id))
			.orderBy(asc(project.name))
	]);
	return rows.map((r) => r.project);
}

/**
 * 見られるプロジェクトのキー。本文の課題キー（PROJ-12）をリンクにするときに使う。
 * 課題の詳細と同じ読み取りの batch に入るよう、呼び出し側は詳細の読み取りと同時に呼ぶ
 */
export function visibleProjectKeys(ctx: AppContext): Promise<Set<string>> {
	const hit = ctx.memo?.get(PROJECT_KEYS_MEMO) as Promise<Set<string>> | undefined;
	if (hit) return hit;
	const keys = listProjects(ctx).then((rows) => new Set(rows.map((p) => p.key)));
	ctx.memo?.set(PROJECT_KEYS_MEMO, keys);
	return keys;
}
const PROJECT_KEYS_MEMO = 'projectKeys';

/**
 * ホーム用。見られるプロジェクトと、進行中のものには未完了（完了以外）の課題数を付けて返す。
 * 課題数は相関副問い合わせで同じ文に入れる（D1 への 1 往復）
 */
export async function listProjectsWithOpenCounts(ctx: AppContext): Promise<{
	active: (ProjectRow & { openCount: number })[];
	archived: ProjectRow[];
}> {
	const openCount = sql<number>`(select count(*) from ${issue}
		where ${issue.projectId} = ${project.id} and ${issue.status} != ${DONE_STATUS} and ${issue.deletedAt} is null)`.as(
		'open_count'
	);
	const query = ctx.db.select({ project, openCount }).from(project).$dynamic();
	const [rows] = await ctx.readBatch([
		(ctx.actor.role === 'admin'
			? query
			: query
					.innerJoin(projectMember, eq(projectMember.projectId, project.id))
					.where(eq(projectMember.userId, ctx.actor.id))
		).orderBy(asc(project.name))
	]);
	return {
		active: rows
			.filter((r) => !r.project.archivedAt)
			.map((r) => ({ ...r.project, openCount: r.openCount })),
		archived: rows.filter((r) => r.project.archivedAt).map((r) => r.project)
	};
}

export function requireProject(ctx: AppContext, key: string): Promise<ProjectRow> {
	const memoKey = projectMemoKey(key);
	const hit = ctx.memo?.get(memoKey) as Promise<ProjectRow> | undefined;
	if (hit) return hit;
	const p = fetchProject(ctx, eq(project.key, key));
	ctx.memo?.set(memoKey, p);
	return p;
}

/** requireProject を ID で引く版。キーを変えても変わらない参照（添付など）から引くときに使う */
export function requireProjectById(ctx: AppContext, id: string): Promise<ProjectRow> {
	return fetchProject(ctx, eq(project.id, id));
}

async function fetchProject(ctx: AppContext, where: SQL): Promise<ProjectRow> {
	const [row] = await ctx.db
		.select({ project, memberId: projectMember.userId })
		.from(project)
		.leftJoin(
			projectMember,
			and(eq(projectMember.projectId, project.id), eq(projectMember.userId, ctx.actor.id))
		)
		.where(where);
	if (!row || (ctx.actor.role !== 'admin' && !row.memberId)) {
		throw new AppError('not_found', 'プロジェクトが見つかりません');
	}
	return row.project;
}

const projectMemoKey = (key: string) => `project:${key}`;

/** プロジェクト行を変更したら、同じリクエスト内の後続の読み取りが古い行を返さないよう破棄する。 */
export function forgetProject(ctx: AppContext, key: string): void {
	ctx.memo?.delete(projectMemoKey(key));
}

export function assertWritable(p: ProjectRow): void {
	if (p.archivedAt) throw new AppError('conflict', 'アーカイブ済みのプロジェクトは変更できません');
}

export async function createProject(ctx: AppContext, input: unknown): Promise<{ key: string }> {
	authorize(ctx.actor, 'project:manage');
	const data = parse(
		v.object({ key: KeySchema, name: ProjectNameSchema, description: DescriptionSchema }),
		input
	);
	const [dup] = await ctx.db
		.select({ id: project.id })
		.from(project)
		.where(eq(project.key, data.key));
	if (dup) throw keyTaken();
	const id = uuidv7();
	await ctx.db.batch([
		ctx.db.insert(project).values({ id, ...data }),
		...defaultFieldInserts(ctx.db, id)
	]);
	return { key: data.key };
}

const keyTaken = () =>
	new AppError('conflict', 'このキーは既に使われています', {
		key: ['このキーは既に使われています']
	});

/** キーを変えると URL と課題キー（ACME-12 など）が変わる。変更後のキーを返す */
export async function updateProject(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<{ key: string }> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	const data = parse(
		v.object({
			key: v.optional(KeySchema),
			name: ProjectNameSchema,
			description: DescriptionSchema,
			icon: IconSchema,
			color: ColorSchema
		}),
		input
	);
	const newKey = data.key ?? p.key;
	if (newKey !== p.key) {
		const [dup] = await ctx.db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.key, newKey));
		if (dup) throw keyTaken();
	}
	await ctx.db
		.update(project)
		.set({
			key: newKey,
			name: data.name,
			description: data.description,
			icon: data.icon || null,
			color: data.color || null
		})
		.where(eq(project.id, p.id));
	forgetProject(ctx, key);
	return { key: newKey };
}

export async function setProjectArchived(
	ctx: AppContext,
	key: string,
	archived: boolean
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	await ctx.db
		.update(project)
		.set({ archivedAt: archived ? new Date() : null })
		.where(eq(project.id, p.id));
	forgetProject(ctx, key);
}

/** プロジェクトの参加者（名前順）。batch にも入れられる */
export function membersQuery(db: DB, of: ProjectCond) {
	return db
		.select({ id: user.id, name: user.name, email: user.email, role: user.role })
		.from(projectMember)
		.innerJoin(user, eq(user.id, projectMember.userId))
		.where(of(projectMember.projectId))
		.orderBy(asc(user.name));
}

export async function listMembers(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	return membersQuery(ctx.db, byProjectId(p.id));
}

export async function addMember(ctx: AppContext, key: string, userId: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	const [u] = await ctx.db.select().from(user).where(eq(user.id, userId));
	if (!u || u.disabledAt || u.role === 'admin') {
		throw new AppError(
			'validation',
			'追加できないユーザーです（管理者は全プロジェクトに参加済みです）'
		);
	}
	await ctx.db.insert(projectMember).values({ projectId: p.id, userId }).onConflictDoNothing();
}

export async function removeMember(ctx: AppContext, key: string, userId: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	await ctx.db.batch([
		ctx.db
			.delete(projectMember)
			.where(and(eq(projectMember.projectId, p.id), eq(projectMember.userId, userId))),
		ctx.db
			.update(issue)
			.set({
				assigneeIds: sql`(select json_group_array(value) from json_each(${issue.assigneeIds}) where value != ${userId})`
			})
			.where(
				and(
					eq(issue.projectId, p.id),
					sql`exists (select 1 from json_each(${issue.assigneeIds}) where value = ${userId})`
				)
			)
	]);
}

/** 担当者にできる人（有効な管理者と参加者）。batch にも入れられる */
export function assignableUsersQuery(db: DB, of: ProjectCond) {
	return db
		.select({ id: user.id, name: user.name, role: user.role })
		.from(user)
		.where(
			and(
				isNull(user.disabledAt),
				or(
					eq(user.role, 'admin'),
					inList(
						user.id,
						db
							.select({ id: projectMember.userId })
							.from(projectMember)
							.where(of(projectMember.projectId))
					)
				)
			)
		)
		.orderBy(asc(user.name));
}

export async function listAssignableUsers(db: DB, projectId: string) {
	return assignableUsersQuery(db, byProjectId(projectId));
}
