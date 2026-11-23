import { describe, expect, it } from 'vitest';
import { createAuth, resetPasswordEmail } from './auth';
import { account } from './db/schema';
import { PASSWORD_HASH_PREFIX } from './password';
import { createTestBase, createTestDb, seedUser } from './test-utils';
import { createFirstAdmin } from './services/setup';
import { upgradeLegacyPassword } from './services/legacy-password';
import { hashPassword } from 'better-auth/crypto';

/** ブラウザで作る鍵（16 進 64 文字）の代わり */
const KEY = 'a'.repeat(64);

const env = {
	BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
	BETTER_AUTH_URL: 'http://localhost:5173'
};

describe('createAuth', () => {
	it('自前で作った credential ユーザーで better-auth のログインができる', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		const authCtx = await auth.$context;
		base.hashPassword = (pw) => authCtx.password.hash(pw);

		await createFirstAdmin(base, {
			name: '管理者',
			email: 'admin@example.com',
			passwordKey: KEY
		});

		const res = await auth.api.signInEmail({
			body: { email: 'admin@example.com', password: KEY }
		});
		expect(res.user.email).toBe('admin@example.com');
		expect(res.token).toBeTruthy();
		const [a] = await db.select().from(account);
		expect(a.password?.startsWith(PASSWORD_HASH_PREFIX)).toBe(true);
	});

	it('間違った鍵は拒否される', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		base.hashPassword = async (pw) => (await auth.$context).password.hash(pw);
		await createFirstAdmin(base, { name: 'A', email: 'a@example.com', passwordKey: KEY });
		await expect(
			auth.api.signInEmail({ body: { email: 'a@example.com', password: 'b'.repeat(64) } })
		).rejects.toThrow();
	});

	it('公開サインアップは無効', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		await expect(
			auth.api.signUpEmail({
				body: { name: 'x', email: 'x@example.com', password: 'password-1234' }
			})
		).rejects.toThrow();
	});

	it('パスワードリセットを要求するとメールを送る', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		const member = await seedUser(db, 'member');
		await auth.api.requestPasswordReset({
			body: { email: member.email, redirectTo: 'http://localhost:5173/reset-password' }
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(base.sent).toHaveLength(1);
		expect(base.sent[0].to).toBe(member.email);
		expect(base.sent[0].text).toContain('/api/auth/reset-password/');
	});

	it('旧形式（scrypt）の人は、保存し直すまで鍵でログインできない', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		base.hashPassword = (pw) => hashPassword(pw);
		await createFirstAdmin(base, { name: 'A', email: 'a@example.com', passwordKey: KEY });
		const signIn = () =>
			auth.api.signInEmail({ body: { email: 'a@example.com', password: 'b'.repeat(64) } });
		await expect(signIn()).rejects.toThrow();
		// createFirstAdmin は鍵を scrypt にかけて保存したので、その鍵が「旧形式の生のパスワード」になる
		expect(await upgradeLegacyPassword(db, { email: 'a@example.com' }, KEY, 'b'.repeat(64))).toBe(
			true
		);
		expect((await signIn()).user.email).toBe('a@example.com');
	});

	describe('パスワードの再設定', () => {
		async function requestReset() {
			const db = await createTestDb();
			const base = createTestBase(db);
			const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
			const authCtx = await auth.$context;
			base.hashPassword = (pw) => authCtx.password.hash(pw);
			await createFirstAdmin(base, { name: 'A', email: 'a@example.com', passwordKey: KEY });
			await auth.api.requestPasswordReset({
				body: { email: 'a@example.com', redirectTo: 'http://localhost:5173/reset-password' }
			});
			await new Promise((r) => setTimeout(r, 10));
			const token = base.sent[0].text.match(/\/api\/auth\/reset-password\/([^?\s]+)/)?.[1];
			if (!token) throw new Error('reset token not found in mail');
			return { auth, token };
		}

		it('有効なトークンなら、その人のメールアドレスがわかる', async () => {
			const { auth, token } = await requestReset();
			expect(await resetPasswordEmail(auth, token)).toBe('a@example.com');
		});

		it('知らないトークンなら null', async () => {
			const { auth } = await requestReset();
			expect(await resetPasswordEmail(auth, 'unknown')).toBeNull();
		});

		it('新しい鍵で再設定するとその鍵でログインでき、使ったトークンは null になる', async () => {
			const { auth, token } = await requestReset();
			const newKey = 'b'.repeat(64);
			await auth.api.resetPassword({ body: { token, newPassword: newKey } });
			const res = await auth.api.signInEmail({
				body: { email: 'a@example.com', password: newKey }
			});
			expect(res.user.email).toBe('a@example.com');
			expect(await resetPasswordEmail(auth, token)).toBeNull();
		});
	});
});
