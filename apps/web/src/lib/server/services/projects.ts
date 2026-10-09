import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { issue, project, projectMember, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';

export type ProjectRow = typeof project.$inferSelect;

const KeySchema = v.pipe(
	v.string(),
	v.trim(),
	v.toUpperCase(),
	v.regex(/^[A-Z][A-Z0-9]{1,9}$/, 'キーは英字で始まる2〜10文字の英数字で入力してください')
);
const ProjectNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'プロジェクト名を入力してください'),
	v.maxLength(100, 'プロジェクト名は100文字以内で入力してください')
);
const DescriptionSchema = v.optional(v.pipe(v.string(), v.maxLength(10_000)), '');

export async function listProjects(ctx: AppContext): Promise<ProjectRow[]> {
	if (ctx.actor.role === 'admin') {
		return ctx.db.select().from(project).orderBy(asc(project.name));
	}
	const rows = await ctx.db
		.select({ project })
		.from(project)
		.innerJoin(projectMember, eq(projectMember.projectId, project.id))
		.where(eq(projectMember.userId, ctx.actor.id))
		.orderBy(asc(project.name));
	return rows.map((r) => r.project);
}

export async function requireProject(ctx: AppContext, key: string): Promise<ProjectRow> {
	const [p] = await ctx.db.select().from(project).where(eq(project.key, key));
	if (!p) throw new AppError('not_found', 'プロジェクトが見つかりません');
	if (ctx.actor.role !== 'admin') {
		const [m] = await ctx.db
			.select({ userId: projectMember.userId })
			.from(projectMember)
			.where(and(eq(projectMember.projectId, p.id), eq(projectMember.userId, ctx.actor.id)));
		if (!m) throw new AppError('not_found', 'プロジェクトが見つかりません');
	}
	return p;
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
	if (dup) {
		throw new AppError('conflict', 'このキーは既に使われています', {
			key: ['このキーは既に使われています']
		});
	}
	await ctx.db.insert(project).values({ id: uuidv7(), ...data });
	return { key: data.key };
}

export async function updateProject(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	const data = parse(v.object({ name: ProjectNameSchema, description: DescriptionSchema }), input);
	await ctx.db.update(project).set(data).where(eq(project.id, p.id));
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
}

export async function listMembers(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select({ id: user.id, name: user.name, email: user.email, role: user.role })
		.from(projectMember)
		.innerJoin(user, eq(user.id, projectMember.userId))
		.where(eq(projectMember.projectId, p.id))
		.orderBy(asc(user.name));
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
			.set({ assigneeId: null })
			.where(and(eq(issue.projectId, p.id), eq(issue.assigneeId, userId)))
	]);
}

export async function listAssignableUsers(db: DB, projectId: string) {
	return db
		.select({ id: user.id, name: user.name, role: user.role })
		.from(user)
		.where(
			and(
				isNull(user.disabledAt),
				or(
					eq(user.role, 'admin'),
					inArray(
						user.id,
						db
							.select({ id: projectMember.userId })
							.from(projectMember)
							.where(eq(projectMember.projectId, projectId))
					)
				)
			)
		)
		.orderBy(asc(user.name));
}

export async function assertAssignable(db: DB, projectId: string, userId: string): Promise<void> {
	const users = await listAssignableUsers(db, projectId);
	if (!users.some((u) => u.id === userId)) {
		throw new AppError('validation', 'このユーザーは担当者にできません', {
			assigneeId: ['このユーザーは担当者にできません']
		});
	}
}
