// 課題の分類項目（ステータス・課題種別・カテゴリー・マイルストーン）。プロジェクトごとに管理者が定義する。
import { and, asc, eq, gte, max, ne, sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import {
	COLORS,
	DEFAULT_ISSUE_TYPES,
	DEFAULT_STATUSES,
	DEFAULT_STATUS_COLOR,
	DONE_STATUS,
	FIXED_STATUSES,
	INITIAL_STATUS,
	STATUS_LABEL,
	type StatusDef
} from '#lib/labels.ts';
import { category, issue, issueStatus, issueType, milestone } from '../db/schema';
import { AppError } from '../errors';
import { DateOrEmptySchema as DateOrEmpty, emptyToNull, parse } from '../validation';
import { assertWritable, requireProject } from './projects';

const NameSchema = (label: string) =>
	v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, `${label}名を入力してください`),
		v.maxLength(50, `${label}名は50文字以内で入力してください`)
	);

const ColorSchema = v.picklist(COLORS, '色を選択してください');

export type IssueTypeRow = typeof issueType.$inferSelect;
export type CategoryRow = typeof category.$inferSelect;
export type MilestoneRow = typeof milestone.$inferSelect;

export async function listCategories(ctx: AppContext, key: string): Promise<CategoryRow[]> {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select()
		.from(category)
		.where(eq(category.projectId, p.id))
		.orderBy(asc(category.createdAt));
}

/** リリース日の早い順。日付未設定（バックログ等）は最後。 */
export async function listMilestones(ctx: AppContext, key: string): Promise<MilestoneRow[]> {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select()
		.from(milestone)
		.where(eq(milestone.projectId, p.id))
		.orderBy(
			sql`${milestone.releaseDate} is null`,
			asc(milestone.releaseDate),
			asc(milestone.name)
		);
}

function duplicate(field: string, label: string): AppError {
	const msg = `同じ名前の${label}が既にあります`;
	return new AppError('conflict', msg, { [field]: [msg] });
}

export async function createCategory(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(v.object({ name: NameSchema('カテゴリー') }), input);
	const [dup] = await ctx.db
		.select({ id: category.id })
		.from(category)
		.where(and(eq(category.projectId, p.id), eq(category.name, data.name)));
	if (dup) throw duplicate('name', 'カテゴリー');
	await ctx.db.insert(category).values({ id: uuidv7(), projectId: p.id, name: data.name });
}

export async function createMilestone(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(
		v.object({ name: NameSchema('マイルストーン'), releaseDate: v.optional(DateOrEmpty) }),
		input
	);
	const [dup] = await ctx.db
		.select({ id: milestone.id })
		.from(milestone)
		.where(and(eq(milestone.projectId, p.id), eq(milestone.name, data.name)));
	if (dup) throw duplicate('name', 'マイルストーン');
	await ctx.db.insert(milestone).values({
		id: uuidv7(),
		projectId: p.id,
		name: data.name,
		releaseDate: emptyToNull(data.releaseDate) ?? null
	});
}

async function requireCategory(db: DB, projectId: string, id: string): Promise<CategoryRow> {
	const [row] = await db
		.select()
		.from(category)
		.where(and(eq(category.projectId, projectId), eq(category.id, id)));
	if (!row) throw new AppError('not_found', 'カテゴリーが見つかりません');
	return row;
}

async function requireMilestone(db: DB, projectId: string, id: string): Promise<MilestoneRow> {
	const [row] = await db
		.select()
		.from(milestone)
		.where(and(eq(milestone.projectId, projectId), eq(milestone.id, id)));
	if (!row) throw new AppError('not_found', 'マイルストーンが見つかりません');
	return row;
}

export async function updateCategory(
	ctx: AppContext,
	key: string,
	id: string,
	input: unknown
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const cur = await requireCategory(ctx.db, p.id, id);
	const data = parse(v.object({ name: NameSchema('カテゴリー') }), input);
	if (data.name === cur.name) return;
	const [dup] = await ctx.db
		.select({ id: category.id })
		.from(category)
		.where(and(eq(category.projectId, p.id), eq(category.name, data.name), ne(category.id, id)));
	if (dup) throw duplicate('name', 'カテゴリー');
	await ctx.db.update(category).set({ name: data.name }).where(eq(category.id, id));
}

export async function updateMilestone(
	ctx: AppContext,
	key: string,
	id: string,
	input: unknown
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await requireMilestone(ctx.db, p.id, id);
	const data = parse(
		v.object({ name: NameSchema('マイルストーン'), releaseDate: v.optional(DateOrEmpty) }),
		input
	);
	const [dup] = await ctx.db
		.select({ id: milestone.id })
		.from(milestone)
		.where(and(eq(milestone.projectId, p.id), eq(milestone.name, data.name), ne(milestone.id, id)));
	if (dup) throw duplicate('name', 'マイルストーン');
	await ctx.db
		.update(milestone)
		.set({ name: data.name, releaseDate: emptyToNull(data.releaseDate) ?? null })
		.where(eq(milestone.id, id));
}

/** 完了にしたマイルストーンは新規の割り当て候補から外れる（既存の課題の設定は残す）。 */
export async function setMilestoneCompleted(
	ctx: AppContext,
	key: string,
	id: string,
	completed: boolean
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const cur = await requireMilestone(ctx.db, p.id, id);
	if (!!cur.completedAt === completed) return;
	await ctx.db
		.update(milestone)
		.set({ completedAt: completed ? new Date() : null })
		.where(eq(milestone.id, id));
}

/** 削除すると、その項目が設定されていた課題は「未設定」に戻る。 */
export async function deleteCategory(ctx: AppContext, key: string, id: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await ctx.db.batch([
		ctx.db
			.update(issue)
			.set({
				categoryIds: sql`(select json_group_array(value) from json_each(${issue.categoryIds}) where value != ${id})`
			})
			.where(
				and(
					eq(issue.projectId, p.id),
					sql`exists (select 1 from json_each(${issue.categoryIds}) where value = ${id})`
				)
			),
		ctx.db.delete(category).where(and(eq(category.projectId, p.id), eq(category.id, id)))
	]);
}

export async function deleteMilestone(ctx: AppContext, key: string, id: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await ctx.db.batch([
		ctx.db
			.update(issue)
			.set({ milestoneId: null })
			.where(and(eq(issue.projectId, p.id), eq(issue.milestoneId, id))),
		ctx.db.delete(milestone).where(and(eq(milestone.projectId, p.id), eq(milestone.id, id)))
	]);
}

// ---- ステータス ----

/** プロジェクト作成時に既定のステータスと課題種別を入れる文 */
export function defaultFieldInserts(db: DB, projectId: string) {
	return [
		db.insert(issueStatus).values(
			DEFAULT_STATUSES.map((key, i) => ({
				projectId,
				key,
				name: STATUS_LABEL[key],
				color: DEFAULT_STATUS_COLOR[key],
				position: i
			}))
		),
		db
			.insert(issueType)
			.values(DEFAULT_ISSUE_TYPES.map((t, i) => ({ id: uuidv7(), projectId, ...t, position: i })))
	] as const;
}

export async function listStatusesOf(db: DB, projectId: string): Promise<StatusDef[]> {
	return db
		.select({ key: issueStatus.key, name: issueStatus.name, color: issueStatus.color })
		.from(issueStatus)
		.where(eq(issueStatus.projectId, projectId))
		.orderBy(asc(issueStatus.position), asc(issueStatus.createdAt));
}

export async function listStatuses(ctx: AppContext, key: string): Promise<StatusDef[]> {
	const p = await requireProject(ctx, key);
	return listStatusesOf(ctx.db, p.id);
}

export async function assertStatusOf(db: DB, projectId: string, key: string): Promise<void> {
	const [row] = await db
		.select({ key: issueStatus.key })
		.from(issueStatus)
		.where(and(eq(issueStatus.projectId, projectId), eq(issueStatus.key, key)));
	if (!row) {
		const msg = 'ステータスが見つかりません';
		throw new AppError('validation', msg, { status: [msg] });
	}
}

const StatusInput = v.object({ name: NameSchema('ステータス'), color: ColorSchema });

async function assertUniqueStatusName(db: DB, projectId: string, name: string, except?: string) {
	const [dup] = await db
		.select({ key: issueStatus.key })
		.from(issueStatus)
		.where(
			and(
				eq(issueStatus.projectId, projectId),
				eq(issueStatus.name, name),
				except ? ne(issueStatus.key, except) : undefined
			)
		);
	if (dup) throw duplicate('name', 'ステータス');
}

/** 追加したステータスは「完了」の直前に並べる */
export async function createStatus(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(StatusInput, input);
	await assertUniqueStatusName(ctx.db, p.id, data.name);
	const statuses = await ctx.db
		.select({ key: issueStatus.key, position: issueStatus.position })
		.from(issueStatus)
		.where(eq(issueStatus.projectId, p.id));
	const done = statuses.find((s) => s.key === DONE_STATUS);
	const last = Math.max(-1, ...statuses.map((s) => s.position));
	const position = done ? done.position : last + 1;
	const insert = ctx.db
		.insert(issueStatus)
		.values({ projectId: p.id, key: uuidv7(), ...data, position });
	if (!done) {
		await insert;
		return;
	}
	await ctx.db.batch([
		ctx.db
			.update(issueStatus)
			.set({ position: sql`${issueStatus.position} + 1` })
			.where(and(eq(issueStatus.projectId, p.id), gte(issueStatus.position, position))),
		insert
	]);
}

export async function updateStatus(
	ctx: AppContext,
	key: string,
	statusKey: string,
	input: unknown
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await assertStatusOf(ctx.db, p.id, statusKey);
	const data = parse(StatusInput, input);
	await assertUniqueStatusName(ctx.db, p.id, data.name, statusKey);
	await ctx.db
		.update(issueStatus)
		.set(data)
		.where(and(eq(issueStatus.projectId, p.id), eq(issueStatus.key, statusKey)));
}

/** 削除すると、そのステータスの課題は「未着手」（初期ステータス）の末尾に移る。未着手と完了は削除できない */
export async function deleteStatus(ctx: AppContext, key: string, statusKey: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	if (FIXED_STATUSES.includes(statusKey)) {
		throw new AppError('validation', 'このステータスは削除できません');
	}
	await assertStatusOf(ctx.db, p.id, statusKey);
	const [moving, [last]] = await Promise.all([
		ctx.db
			.select({ id: issue.id })
			.from(issue)
			.where(and(eq(issue.projectId, p.id), eq(issue.status, statusKey)))
			.orderBy(asc(issue.position), asc(issue.number)),
		ctx.db
			.select({ max: max(issue.position) })
			.from(issue)
			.where(and(eq(issue.projectId, p.id), eq(issue.status, INITIAL_STATUS)))
	]);
	const keys = generateNKeysBetween(last?.max ?? null, null, moving.length);
	await ctx.db.batch([
		ctx.db
			.delete(issueStatus)
			.where(and(eq(issueStatus.projectId, p.id), eq(issueStatus.key, statusKey))),
		...moving.map((r, i) =>
			ctx.db
				.update(issue)
				.set({ status: INITIAL_STATUS, position: keys[i] })
				.where(eq(issue.id, r.id))
		)
	]);
}

/** 表示順を 1 つ前（-1）か後ろ（+1）の項目と入れ替える */
export async function moveStatus(
	ctx: AppContext,
	key: string,
	statusKey: string,
	dir: -1 | 1
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const rows = await ctx.db
		.select({ key: issueStatus.key })
		.from(issueStatus)
		.where(eq(issueStatus.projectId, p.id))
		.orderBy(asc(issueStatus.position), asc(issueStatus.createdAt));
	const order = swapped(
		rows.map((r) => r.key),
		statusKey,
		dir
	);
	if (!order) return;
	const [first, ...rest] = order.map((k, i) =>
		ctx.db
			.update(issueStatus)
			.set({ position: i })
			.where(and(eq(issueStatus.projectId, p.id), eq(issueStatus.key, k)))
	);
	await ctx.db.batch([first, ...rest]);
}

function swapped(ids: string[], id: string, dir: -1 | 1): string[] | null {
	const i = ids.indexOf(id);
	const j = i + dir;
	if (i === -1 || j < 0 || j >= ids.length) return null;
	const next = [...ids];
	[next[i], next[j]] = [next[j], next[i]];
	return next;
}

// ---- 課題種別 ----

export async function listIssueTypesOf(db: DB, projectId: string): Promise<IssueTypeRow[]> {
	return db
		.select()
		.from(issueType)
		.where(eq(issueType.projectId, projectId))
		.orderBy(asc(issueType.position), asc(issueType.createdAt));
}

export async function listIssueTypes(ctx: AppContext, key: string): Promise<IssueTypeRow[]> {
	const p = await requireProject(ctx, key);
	return listIssueTypesOf(ctx.db, p.id);
}

const IssueTypeInput = v.object({
	name: NameSchema('課題種別'),
	color: ColorSchema,
	template: v.optional(
		v.pipe(
			v.string(),
			v.transform((t) => t.replace(/\r\n/g, '\n')),
			v.maxLength(50_000, 'テンプレートは50,000文字以内で入力してください')
		)
	)
});

async function assertUniqueTypeName(db: DB, projectId: string, name: string, except?: string) {
	const [dup] = await db
		.select({ id: issueType.id })
		.from(issueType)
		.where(
			and(
				eq(issueType.projectId, projectId),
				eq(issueType.name, name),
				except ? ne(issueType.id, except) : undefined
			)
		);
	if (dup) throw duplicate('name', '課題種別');
}

export async function createIssueType(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(IssueTypeInput, input);
	await assertUniqueTypeName(ctx.db, p.id, data.name);
	const [last] = await ctx.db
		.select({ max: max(issueType.position) })
		.from(issueType)
		.where(eq(issueType.projectId, p.id));
	await ctx.db
		.insert(issueType)
		.values({ id: uuidv7(), projectId: p.id, ...data, position: (last?.max ?? -1) + 1 });
}

export async function updateIssueType(
	ctx: AppContext,
	key: string,
	id: string,
	input: unknown
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await assertIssueTypeOf(ctx.db, p.id, id);
	const data = parse(IssueTypeInput, input);
	await assertUniqueTypeName(ctx.db, p.id, data.name, id);
	await ctx.db.update(issueType).set(data).where(eq(issueType.id, id));
}

/** 削除すると、その種別が設定されていた課題は未設定になる */
export async function deleteIssueType(ctx: AppContext, key: string, id: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await ctx.db.batch([
		ctx.db
			.update(issue)
			.set({ typeId: null })
			.where(and(eq(issue.projectId, p.id), eq(issue.typeId, id))),
		ctx.db.delete(issueType).where(and(eq(issueType.projectId, p.id), eq(issueType.id, id)))
	]);
}

export async function moveIssueType(
	ctx: AppContext,
	key: string,
	id: string,
	dir: -1 | 1
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const rows = await listIssueTypesOf(ctx.db, p.id);
	const order = swapped(
		rows.map((r) => r.id),
		id,
		dir
	);
	if (!order) return;
	const [first, ...rest] = order.map((tid, i) =>
		ctx.db.update(issueType).set({ position: i }).where(eq(issueType.id, tid))
	);
	await ctx.db.batch([first, ...rest]);
}

export async function assertIssueTypeOf(db: DB, projectId: string, id: string): Promise<void> {
	const [row] = await db
		.select({ id: issueType.id })
		.from(issueType)
		.where(and(eq(issueType.projectId, projectId), eq(issueType.id, id)));
	if (!row) {
		const msg = '課題種別が見つかりません';
		throw new AppError('validation', msg, { typeId: [msg] });
	}
}
