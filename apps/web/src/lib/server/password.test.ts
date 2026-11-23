import { hashPassword } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import { hashPasswordKey, PASSWORD_HASH_PREFIX, verifyPasswordKey } from './password';
import { sha256Hex } from './tokens';

const KEY = 'a'.repeat(64);

describe('password', () => {
	it('鍵の SHA-256 を接頭辞付きで保存する', async () => {
		expect(PASSWORD_HASH_PREFIX).toBe('pbkdf2-sha256$600000$');
		expect(await hashPasswordKey(KEY)).toBe(PASSWORD_HASH_PREFIX + (await sha256Hex(KEY)));
	});

	it('同じ鍵なら照合が通り、違う鍵なら通らない', async () => {
		const hash = await hashPasswordKey(KEY);
		expect(await verifyPasswordKey({ hash, password: KEY })).toBe(true);
		expect(await verifyPasswordKey({ hash, password: 'b'.repeat(64) })).toBe(false);
	});

	it('旧形式（scrypt）のハッシュには例外を投げず false を返す', async () => {
		const hash = await hashPassword('password-1234');
		expect(await verifyPasswordKey({ hash, password: KEY })).toBe(false);
		expect(await verifyPasswordKey({ hash, password: 'password-1234' })).toBe(false);
	});
});
