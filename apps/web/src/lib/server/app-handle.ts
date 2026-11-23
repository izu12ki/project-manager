import { getRequestEvent } from '$app/server';
import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { svelteKitHandler, sveltekitCookies } from 'better-auth/svelte-kit';
import { env, waitUntil } from 'cloudflare:workers';
import { createAuth } from '#lib/server/auth.ts';
import { isAllowedAuthRequest, type Role } from '#lib/server/authz.ts';
import { createDb } from '#lib/server/db/index.ts';
import { createReadBatcher } from '#lib/server/db/read-batch.ts';
import { readEnv } from '#lib/server/env.ts';
import { createMailer } from '#lib/server/mailer/index.ts';

const PUBLIC_PATHS = [
	/^\/login$/,
	/^\/setup$/,
	/^\/forgot-password$/,
	/^\/reset-password$/,
	/^\/invite\/[^/]+$/,
	/^\/api\/auth\//
];

// hooks.server.ts が最初のリクエストで import する（better-auth や drizzle を Worker の起動時に読み込まないため）
export const app: Handle = async ({ event, resolve }) => {
	const appEnv = readEnv(env);
	const db = createDb(env.DB);
	const mailer = createMailer({ ...appEnv, EMAIL: env.EMAIL });
	const auth = createAuth(appEnv, db, {
		mailer,
		waitUntil,
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	const authCtx = await auth.$context;

	event.locals.auth = auth;
	event.locals.base = {
		db,
		readBatch: createReadBatcher(db),
		mailer,
		bucket: env.BUCKET,
		waitUntil,
		// Workers の fetch は this が違うと Illegal invocation になるので包む
		fetch: (input, init) => fetch(input, init),
		slackBotToken: appEnv.SLACK_BOT_TOKEN || null,
		baseUrl: appEnv.BETTER_AUTH_URL,
		hashPassword: (pw) => authCtx.password.hash(pw),
		memo: new Map()
	};

	// 外部 API は Cookie セッションを一切使わない（Bearer 認証は各ハンドラで行う）
	if (event.url.pathname.startsWith('/api/v1/')) {
		event.locals.user = null;
		return resolve(event);
	}

	// 書き込み（GET・HEAD 以外）は Cookie のキャッシュを使わず、DB でセッションを確かめる。
	// 無効化・降格した人が反映までの数分間に管理操作などを続けられないようにする
	// （このときキャッシュも新しい内容で書き直されるので、続く閲覧にもすぐ反映される）
	const fresh = event.request.method !== 'GET' && event.request.method !== 'HEAD';
	const s = await auth.api.getSession({
		headers: event.request.headers,
		query: fresh ? { disableCookieCache: true } : undefined
	});
	if (s?.user.disabledAt) {
		await authCtx.internalAdapter.deleteUserSessions(s.user.id);
	}
	event.locals.user =
		s && !s.user.disabledAt
			? { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role as Role }
			: null;

	const path = event.url.pathname;
	if (!event.locals.user && !PUBLIC_PATHS.some((r) => r.test(path))) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
	}
	if (!isAllowedAuthRequest(event.request.method, path)) error(404, 'Not found');

	return svelteKitHandler({ auth, event, resolve, building: false });
};
