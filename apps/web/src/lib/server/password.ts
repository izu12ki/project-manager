import { constantTimeEqual } from 'better-auth/crypto';
import { sha256Hex } from './tokens';

/**
 * 保存形式の接頭辞。ブラウザで PBKDF2-SHA256（60 万回）をかけた鍵を、サーバーで SHA-256 にして保存する。
 * 接頭辞の無いもの（web@0.3 までの better-auth の既定の scrypt）は照合できない。パスワードの再設定で作り直す
 */
export const PASSWORD_HASH_PREFIX = 'pbkdf2-sha256$600000$';

/** better-auth の emailAndPassword.password.hash。受け取るのはブラウザで作った鍵（生のパスワードではない） */
export async function hashPasswordKey(key: string): Promise<string> {
	return PASSWORD_HASH_PREFIX + (await sha256Hex(key));
}

/** better-auth の emailAndPassword.password.verify。接頭辞の無い旧形式のハッシュは常に false */
export async function verifyPasswordKey({
	hash,
	password
}: {
	hash: string;
	password: string;
}): Promise<boolean> {
	if (!hash.startsWith(PASSWORD_HASH_PREFIX)) return false;
	return constantTimeEqual(hash, await hashPasswordKey(password));
}
