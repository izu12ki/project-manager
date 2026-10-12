import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { betterAuth } from 'better-auth';
import type { sveltekitCookies } from 'better-auth/svelte-kit';
import type { DB } from './db';
import { account, rateLimit, session, user, verification } from './db/schema';
import type { AppEnv } from './env';
import type { Mailer } from './mailer';
import { resetPasswordMail } from './mailer/templates';

export function createAuth(
	env: Pick<AppEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>,
	db: DB,
	opts: {
		mailer: Mailer;
		waitUntil: (p: Promise<unknown>) => void;
		plugins?: ReturnType<typeof sveltekitCookies>[];
	}
) {
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema: { user, session, account, verification, rateLimit }
		}),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			minPasswordLength: 10,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: 3600,
			sendResetPassword: async ({ user: u, url }) => {
				opts.waitUntil(
					opts.mailer
						.send({ to: u.email, ...resetPasswordMail({ url }) })
						.catch((e) => console.error('reset password mail failed', e))
				);
			}
		},
		session: {
			// 署名付き Cookie でセッションを検証し、リクエスト毎の DB 参照を省く。
			// 無効化・ロール変更・ログアウト時の反映は最大 maxAge 遅れる。
			cookieCache: { enabled: true, maxAge: 5 * 60 }
		},
		user: {
			additionalFields: {
				role: {
					type: ['admin', 'member', 'guest'],
					required: true,
					input: false,
					defaultValue: 'member'
				},
				disabledAt: { type: 'date', required: false, input: false }
			}
		},
		rateLimit: {
			enabled: true,
			storage: 'database',
			window: 60,
			max: 100,
			customRules: {
				'/sign-in/email': { window: 60, max: 5 },
				'/request-password-reset': { window: 300, max: 3 }
			}
		},
		advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
		plugins: opts.plugins ?? []
	});
}

export type Auth = ReturnType<typeof createAuth>;
