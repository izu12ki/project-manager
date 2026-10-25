import { json, type RequestEvent } from '@sveltejs/kit';
import type { AppContext } from './context';
import { AppError, type ErrorCode } from './errors';
import { consumeRateLimit } from './ratelimit';
import { API_RATE_LIMIT, authenticateApiKey } from './services/api-keys';

const STATUS: Record<ErrorCode, number> = {
	validation: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	rate_limited: 429
};

/** AppError を共通のエラー形式に変換する。それ以外は内部情報を出さず 500 にする */
export function apiError(e: unknown): Response {
	if (e instanceof AppError) {
		return json(
			{ error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } },
			{ status: STATUS[e.code] }
		);
	}
	console.error('api unexpected error', e);
	return json(
		{ error: { code: 'internal', message: 'サーバーエラーが発生しました' } },
		{ status: 500 }
	);
}

function bearerToken(request: Request): string | null {
	const m = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
	return m ? m[1] : null;
}

/** Bearer 認証・レート制限・エラー変換をまとめた /api/v1 のハンドラ */
export async function apiHandler(
	event: RequestEvent,
	fn: (ctx: AppContext) => Promise<unknown>,
	opts: { status?: number } = {}
): Promise<Response> {
	try {
		const base = event.locals.base;
		const token = bearerToken(event.request);
		const auth = token ? await authenticateApiKey(base, token) : null;
		if (!auth) throw new AppError('unauthorized', 'APIキーが無効です');
		if (!(await consumeRateLimit(base.db, `app:api:${auth.apiKeyId}`, API_RATE_LIMIT))) {
			throw new AppError(
				'rate_limited',
				'リクエストが多すぎます。しばらくしてから再度お試しください'
			);
		}
		const result = await fn({ ...base, actor: auth.actor });
		return json(result, { status: opts.status ?? 200 });
	} catch (e) {
		return apiError(e);
	}
}

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new AppError('validation', 'JSON の形式が正しくありません');
	}
}

/** 応答に載せるユーザーは id と name だけ（メールアドレスは出さない） */
export function apiUser(u: { id: string; name: string }): { id: string; name: string } {
	return { id: u.id, name: u.name };
}
