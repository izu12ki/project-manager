import { building } from '$app/env';
import { getRequestEvent } from '$app/server';
import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type HandleServerError } from '@sveltejs/kit/hooks';
import { svelteKitHandler, sveltekitCookies } from 'better-auth/svelte-kit';
import { env, waitUntil } from 'cloudflare:workers';
import { createAuth } from '#lib/server/auth.ts';
import { isAllowedAuthRequest, type Role } from '#lib/server/authz.ts';
import { buildCachedReads } from '#lib/server/db/cached-read.ts';
import { createDb } from '#lib/server/db/index.ts';
import { createReadBatcher } from '#lib/server/db/read-batch.ts';
// 起動時に組み立てる読み取りの文（buildCachedReads）を登録させるため、画面の読み取りのモジュールを読み込んでおく
import '#lib/server/services/issue-detail.ts';
import '#lib/server/services/issue-list.ts';
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

/**
 * 設定・DB・メール・認証は isolate ごとに 1 回だけ作り、リクエストをまたいで使う。
 * better-auth はインスタンスを作るたびに表の定義やアダプターを組み立て直し、リクエストごとに作ると
 * 1 回 0.7〜2ms かかっていた。どれもリクエストごとの状態を持たない（Cookie はプラグインが
 * getRequestEvent で、waitUntil は今のリクエストのものを使う）。
 * 画面の読み取りの文（db/cached-read.ts）もここで組み立てておく
 */
function createServices() {
	const appEnv = readEnv(env);
	const db = createDb(env.DB);
	buildCachedReads(db);
	const mailer = createMailer({ ...appEnv, EMAIL: env.EMAIL });
	const auth = createAuth(appEnv, db, {
		mailer,
		waitUntil,
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	return auth.$context.then((authCtx) => ({ appEnv, db, mailer, auth, authCtx }));
}
let services: ReturnType<typeof createServices> | undefined;

function startServices() {
	if (!services) {
		services = createServices();
		// 失敗したら次のリクエストで作り直す（起動時の失敗を未処理の reject にもしない）
		services.catch(() => (services = undefined));
	}
	return services;
}

// Worker の起動時（モジュールの評価）に作り始める。起動時の CPU 時間はリクエストの上限（Free の 10ms）とは
// 別に数えるので、isolate の最初のリクエストで作る分（手元で数 ms）を軽くできる。ビルド中は環境変数がないので作らない
if (!building) void startServices();

const app: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	const { appEnv, db, mailer, auth, authCtx } = await startServices();

	event.locals.auth = auth;
	event.locals.base = {
		db,
		readBatch: createReadBatcher(db),
		mailer,
		mailConfigured: appEnv.MAIL_PROVIDER !== 'console',
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

	return svelteKitHandler({ auth, event, resolve, building });
};

// CSP（フレームへの埋め込みの禁止を含む）は vite.config.ts の csp で SvelteKit がページに付ける
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	return response;
};

export const handle = sequence(securityHeaders, app);

export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[${event.request.method} ${event.url.pathname}]`, error);
	return { message: 'エラーが発生しました。時間をおいて再度お試しください' };
};
