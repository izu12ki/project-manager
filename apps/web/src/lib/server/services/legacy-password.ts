// 移行期間だけ使う: better-auth の既定（scrypt）で保存した旧形式のハッシュを、ブラウザで作る鍵の形式に保存し直す。
// ログインとパスワード変更（現在のパスワード）では、移行期間のあいだ生のパスワードも送ってもらう。
// 本番で SELECT count(*) FROM account WHERE password NOT LIKE 'pbkdf2-sha256$%' が 0 になったら、
// このファイルと呼び出し元（login と account の +page.server.ts）、画面の keepRaw を消す
import { verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { account, user } from '../db/schema';
import { hashPasswordKey, PASSWORD_HASH_PREFIX } from '../password';

/** 旧形式で保存できた最大の長さ（以前の maxPasswordLength）。これより長いものは scrypt にかけずに断る */
const MAX_LEGACY_PASSWORD_LENGTH = 128;

/**
 * 旧形式のハッシュを持つ人の生のパスワードが scrypt で照合できたら、鍵（passwordKey）の形式で保存し直す。
 * 保存し直したら true。新形式・照合できない・該当なしは false（呼び出し側はそのままふつうのログインに進む）
 */
export async function upgradeLegacyPassword(
	db: DB,
	who: { email: string } | { userId: string },
	password: string,
	passwordKey: string
): Promise<boolean> {
	if (password.length > MAX_LEGACY_PASSWORD_LENGTH) return false;
	const [row] = await db
		.select({ id: account.id, hash: account.password })
		.from(account)
		.innerJoin(user, eq(user.id, account.userId))
		.where(
			and(
				eq(account.providerId, 'credential'),
				'email' in who ? eq(user.email, who.email) : eq(account.userId, who.userId)
			)
		);
	if (!row?.hash || row.hash.startsWith(PASSWORD_HASH_PREFIX)) return false;
	if (!(await verifyPassword({ hash: row.hash, password }))) return false;
	await db
		.update(account)
		.set({ password: await hashPasswordKey(passwordKey) })
		.where(eq(account.id, row.id));
	return true;
}
