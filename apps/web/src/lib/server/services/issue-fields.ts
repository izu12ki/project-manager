// 課題の分類項目（カテゴリー・マイルストーン）。プロジェクトごとに管理者が定義する。
import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { category, issue, milestone } from '../db/schema';
import { AppError } from '../errors';
import { emptyToNull, parse } from '../validation';
import { assertWritable, requireProject } from './projects';

const NameSchema = (label: string) =>
	v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, `${label}名を入力してください`),
		v.maxLength(50, `${label}名は50文字以内で入力してください`)
	);
const DateOrEmpty = v.union(
	[v.literal(''), v.pipe(v.string(), v.isoDate())],
	'日付の形式が正しくありません'
);

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

/** 削除すると、その項目が設定されていた課題は「未設定」に戻る。 */
export async function deleteCategory(ctx: AppContext, key: string, id: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);
	await ctx.db.batch([
		ctx.db
			.update(issue)
			.set({ categoryId: null })
			.where(and(eq(issue.projectId, p.id), eq(issue.categoryId, id))),
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

export async function assertCategoryOf(db: DB, projectId: string, id: string): Promise<void> {
	const [row] = await db
		.select({ id: category.id })
		.from(category)
		.where(and(eq(category.projectId, projectId), eq(category.id, id)));
	if (!row) {
		throw new AppError('validation', 'カテゴリーが見つかりません', {
			categoryId: ['カテゴリーが見つかりません']
		});
	}
}

export async function assertMilestoneOf(db: DB, projectId: string, id: string): Promise<void> {
	const [row] = await db
		.select({ id: milestone.id })
		.from(milestone)
		.where(and(eq(milestone.projectId, projectId), eq(milestone.id, id)));
	if (!row) {
		throw new AppError('validation', 'マイルストーンが見つかりません', {
			milestoneId: ['マイルストーンが見つかりません']
		});
	}
}
