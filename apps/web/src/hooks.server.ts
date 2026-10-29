import { building } from '$app/env';
import { getRequestEvent } from '$app/server';
import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { svelteKitHandler, sveltekitCookies } from 'better-auth/svelte-kit';
import { env, waitUntil } from 'cloudflare:workers';
import { createAuth } from '$lib/server/auth';
import type { Role } from '$lib/server/authz';
import { createDb } from '$lib/server/db';
import { readEnv } from '$lib/server/env';
import { createMailer } from '$lib/server/mailer';

const PUBLIC_PATHS = [
	/^\/login$/,
	/^\/setup$/,
	/^\/forgot-password$/,
	/^\/reset-password$/,
	/^\/invite\/[^/]+$/,
	/^\/api\/auth\//
];

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	const appEnv = readEnv(env);
	const db = createDb(appEnv);
	const mailer = createMailer(appEnv);
	const auth = createAuth(appEnv, db, {
		mailer,
		waitUntil,
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	const authCtx = await auth.$context;

	event.locals.auth = auth;
	event.locals.base = {
		db,
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

	return svelteKitHandler({ auth, event, resolve, building });
};

export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[${event.request.method} ${event.url.pathname}]`, error);
	return { message: 'エラーが発生しました。時間をおいて再度お試しください' };
};
