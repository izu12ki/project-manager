import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derivePasswordKey } from './password-key';

// ブラウザの WebCrypto とは別の実装（node:crypto）で期待値を作る
const expected = pbkdf2Sync(
	'password-1234',
	'project-manager:password:a@example.com',
	600_000,
	32,
	'sha256'
).toString('hex');

describe('derivePasswordKey', () => {
	it('PBKDF2-SHA256 60 万回の鍵を 16 進で返す', async () => {
		expect(await derivePasswordKey('a@example.com', 'password-1234')).toBe(expected);
	});

	it('メールアドレスは trim して小文字にしてからソルトにする', async () => {
		expect(await derivePasswordKey('  A@Example.COM ', 'password-1234')).toBe(expected);
	});

	it('パスワードは NFKC で正規化する（全角で打っても同じ鍵。旧形式の scrypt と同じ扱い）', async () => {
		expect(await derivePasswordKey('a@example.com', 'ｐａｓｓｗｏｒｄ-１２３４')).toBe(expected);
	});

	it('メールアドレスが違えば鍵も違う', async () => {
		expect(await derivePasswordKey('b@example.com', 'password-1234')).not.toBe(expected);
	});
});
