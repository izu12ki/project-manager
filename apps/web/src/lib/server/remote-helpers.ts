import { error, invalid } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { appContext, type AppContext } from './context';
import { AppError, handleLoad } from './errors';

/** remote function 内で現在のリクエストのコンテキストを得る */
export function remoteContext(): AppContext {
	return appContext(getRequestEvent().locals);
}

/** query 用。AppError を load と同じく 404/400 に変換する */
export const runQuery = handleLoad;

const STATUS = { validation: 400, conflict: 409, rate_limited: 429 } as const;

async function mutate<T>(fn: () => Promise<T>, onFailure: (e: AppError) => never): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (!(e instanceof AppError)) throw e;
		if (e.code === 'not_found' || e.code === 'forbidden') error(404, 'Not found');
		onFailure(e);
	}
}

/** form 用。権限・存在エラーは 404、それ以外はフォームの issue（allIssues）として返す */
export const runForm = <T>(fn: () => Promise<T>) => mutate(fn, (e) => invalid(e.message));

/** command 用。権限・存在エラーは 404、それ以外はメッセージ付きの HTTP エラーにする */
export const runCommand = <T>(fn: () => Promise<T>) =>
	mutate(fn, (e) => error(STATUS[e.code as keyof typeof STATUS], e.message));
