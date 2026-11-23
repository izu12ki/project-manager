import { building } from '$app/env';
import { sequence, type Handle, type HandleServerError } from '@sveltejs/kit/hooks';

// 認証・DB・メールのモジュールは最初のリクエストで読み込む。Worker の起動（グローバルスコープの評価）に含めない
let appHandle: Promise<typeof import('#lib/server/app-handle.ts')> | undefined;

const app: Handle = async (input) => {
	if (building) return input.resolve(input.event);
	appHandle ??= import('#lib/server/app-handle.ts').catch((e: unknown) => {
		appHandle = undefined;
		throw e;
	});
	const { app } = await appHandle;
	return app(input);
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
