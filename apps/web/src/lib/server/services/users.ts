import { and, asc, eq, exists, isNull, ne, or } from 'drizzle-orm';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { session, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';

/**
 * Backlog の取り込みで、登録者・コメントの投稿者に対応する人がいないときに使う専用のユーザー。
 * account 行がないのでログインできず、無効化済みなので担当者・メンション・通知の対象にもならない。
 * ユーザーの一覧には出さない。最初に必要になった取り込みの batch で作る
 */
export const UNKNOWN_USER_ID = 'unknown-user';
export const UNKNOWN_USER_NAME = '不明なユーザー';

/** 不明なユーザーを作る文（既にあれば何もしない）。取り込みの batch に入れる */
export function unknownUserInsert(db: DB) {
	return db
		.insert(user)
		.values({
			id: UNKNOWN_USER_ID,
			name: UNKNOWN_USER_NAME,
			email: 'unknown-user@invalid',
			role: 'guest',
			disabledAt: new Date()
		})
		.onConflictDoNothing();
}

/** 管理画面のユーザー一覧（登録順。「不明なユーザー」は除く）。batch にも入れられる */
export function usersQuery(db: DB) {
	return db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			disabledAt: user.disabledAt,
			createdAt: user.createdAt
		})
		.from(user)
		.where(ne(user.id, UNKNOWN_USER_ID))
		.orderBy(asc(user.createdAt));
}

export async function listUsers(ctx: AppContext) {
	authorize(ctx.actor, 'user:manage');
	return usersQuery(ctx.db);
}

/**
 * 対象が管理者なら、ほかに有効（無効化されていない）な管理者がいること。更新の条件に入れて確認と更新を
 * 1 つの文で行い、管理者どうしが同時に無効化・降格し合っても 0 人にならないようにする
 */
const keepsActiveAdmin = (db: DB, userId: string) =>
	or(
		ne(user.role, 'admin'),
		exists(
			db
				.select({ id: user.id })
				.from(user)
				.where(and(eq(user.role, 'admin'), isNull(user.disabledAt), ne(user.id, userId)))
		)
	);

/** 不明なユーザーは一覧に出さないので、操作もできない（有効にすると担当者などの候補に出てしまう） */
function rejectUnknownUser(userId: string): void {
	if (userId === UNKNOWN_USER_ID) throw new AppError('not_found', 'ユーザーが見つかりません');
}

/** 条件付きの更新が 0 件だったときの理由（対象がいないのか、管理者が残らないのか） */
async function rejectUpdate(db: DB, userId: string, message: string): Promise<never> {
	const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
	if (!target) throw new AppError('not_found', 'ユーザーが見つかりません');
	throw new AppError('validation', message);
}

export async function disableUser(ctx: AppContext, userId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	rejectUnknownUser(userId);
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身は無効化できません');
	const updated = await ctx.db
		.update(user)
		.set({ disabledAt: new Date() })
		.where(and(eq(user.id, userId), keepsActiveAdmin(ctx.db, userId)))
		.returning({ id: user.id });
	if (updated.length === 0) {
		await rejectUpdate(ctx.db, userId, '管理者が 1 人もいなくなるため無効化できません');
	}
	await ctx.db.delete(session).where(eq(session.userId, userId));
}

const RoleInput = v.picklist(['admin', 'member', 'guest', 'viewer'], 'ロールを選択してください');

export async function changeUserRole(
	ctx: AppContext,
	userId: string,
	role: unknown
): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	rejectUnknownUser(userId);
	const newRole = parse(RoleInput, role);
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身のロールは変更できません');
	const updated = await ctx.db
		.update(user)
		.set({ role: newRole })
		.where(
			and(eq(user.id, userId), newRole === 'admin' ? undefined : keepsActiveAdmin(ctx.db, userId))
		)
		.returning({ id: user.id });
	if (updated.length === 0) {
		await rejectUpdate(ctx.db, userId, '管理者が 1 人もいなくなるため変更できません');
	}
	// 古い権限のままのセッションを残さない
	await ctx.db.delete(session).where(eq(session.userId, userId));
}

export async function enableUser(ctx: AppContext, userId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	rejectUnknownUser(userId);
	// 無効化された管理者が、反映前のセッションで自分を戻せないようにする
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身は有効化できません');
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
