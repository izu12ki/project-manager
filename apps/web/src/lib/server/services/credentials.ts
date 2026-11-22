import { eq, notExists, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Role } from '../authz';
import type { DB } from '../db';
import { account, user } from '../db/schema';

type CredentialUserInput = { name: string; email: string; role: Role; passwordHash: string };

/**
 * better-auth の signUpEmail と同じ形で user と credential account を作る insert を返す（実行はしない）。
 * D1 はトランザクションを使えないので、呼び出し側で db.batch() にまとめて流すこと。
 * onlyIfNoUsers のときは、ユーザーが 1 人もいない場合だけ作る（初期セットアップの同時実行対策）。
 * 作られたかどうかは、返した id の user があるかで確かめる。
 */
export function credentialUserInserts(
	db: DB,
	input: CredentialUserInput,
	opts: { onlyIfNoUsers?: boolean } = {}
) {
	const id = uuidv7();
	const accountRow = {
		id: uuidv7(),
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: input.passwordHash
	};
	if (!opts.onlyIfNoUsers) {
		return {
			id,
			statements: [
				db.insert(user).values({
					id,
					name: input.name,
					email: input.email,
					role: input.role,
					emailVerified: true
				}),
				db.insert(account).values(accountRow)
			] as const
		};
	}
	const userSelect = db
		.select({
			id: sql<string>`${id}`.as('id'),
			name: sql<string>`${input.name}`.as('name'),
			email: sql<string>`${input.email}`.as('email'),
			role: sql<Role>`${input.role}`.as('role'),
			emailVerified: sql<boolean>`1`.as('emailVerified')
		})
		.from(sql`(select 1)`)
		.where(notExists(db.select({ one: sql`1` }).from(user)));
	// user を作れなかった（先に誰かが作った）ときは account も作らない
	const accountSelect = db
		.select({
			id: sql<string>`${accountRow.id}`.as('id'),
			accountId: sql<string>`${id}`.as('accountId'),
			providerId: sql<string>`${accountRow.providerId}`.as('providerId'),
			userId: user.id,
			password: sql<string>`${accountRow.password}`.as('password')
		})
		.from(user)
		.where(eq(user.id, id));
	return {
		id,
		statements: [
			db.insert(user).select(userSelect),
			db.insert(account).select(accountSelect)
		] as const
	};
}
