import { asc, eq } from 'drizzle-orm';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { session, user } from '../db/schema';
import { AppError } from '../errors';

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

export async function isDisabledEmail(db: DB, email: string): Promise<boolean> {
	const [row] = await db
		.select({ disabledAt: user.disabledAt })
		.from(user)
		.where(eq(user.email, email));
	return !!row?.disabledAt;
}
