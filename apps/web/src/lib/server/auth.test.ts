import { describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import { account } from './db/schema';
import { PASSWORD_HASH_PREFIX } from './password';
import { createTestBase, createTestDb, seedUser } from './test-utils';
import { createFirstAdmin } from './services/setup';

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
});
