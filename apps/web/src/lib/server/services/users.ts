import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { session, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';

export async function listUsers(ctx: AppContext) {
	authorize(ctx.actor, 'user:manage');
	return ctx.db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			disabledAt: user.disabledAt,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(asc(user.createdAt));
}

export async function disableUser(ctx: AppContext, userId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身は無効化できません');
	const updated = await ctx.db
		.update(user)
		.set({ disabledAt: new Date() })
		.where(eq(user.id, userId))
		.returning({ id: user.id });
	if (updated.length === 0) throw new AppError('not_found', 'ユーザーが見つかりません');
	await ctx.db.delete(session).where(eq(session.userId, userId));
}

const RoleInput = v.picklist(['admin', 'member', 'guest'], 'ロールを選択してください');

export async function changeUserRole(
	ctx: AppContext,
	userId: string,
	role: unknown
): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	const newRole = parse(RoleInput, role);
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身のロールは変更できません');
	const [target] = await ctx.db.select({ role: user.role }).from(user).where(eq(user.id, userId));
	if (!target) throw new AppError('not_found', 'ユーザーが見つかりません');
	if (target.role === 'admin' && newRole !== 'admin') {
		// 対象以外に有効（無効化されていない）なアドミンが残らない変更は拒否する
		const [other] = await ctx.db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.role, 'admin'), isNull(user.disabledAt), ne(user.id, userId)))
			.limit(1);
		if (!other) throw new AppError('validation', 'アドミンが 1 人もいなくなるため変更できません');
	}
	await ctx.db.update(user).set({ role: newRole }).where(eq(user.id, userId));
	// 古い権限のままのセッションを残さない
	await ctx.db.delete(session).where(eq(session.userId, userId));
}

export async function enableUser(ctx: AppContext, userId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	const updated = await ctx.db
		.update(user)
		.set({ disabledAt: null })
		.where(eq(user.id, userId))
		.returning({ id: user.id });
	if (updated.length === 0) throw new AppError('not_found', 'ユーザーが見つかりません');
}

export async function isDisabledEmail(db: DB, email: string): Promise<boolean> {
	const [row] = await db
		.select({ disabledAt: user.disabledAt })
		.from(user)
		.where(eq(user.email, email));
	return !!row?.disabledAt;
}
