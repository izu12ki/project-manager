import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';

export type ErrorCode =
	'not_found' | 'forbidden' | 'unauthorized' | 'validation' | 'conflict' | 'rate_limited';

export class AppError extends Error {
	constructor(
		public code: ErrorCode,
		message: string,
		public fields?: Record<string, string[]>
	) {
		super(message);
		this.name = 'AppError';
	}
}

/** DB のエラー（cause をたどる）が、一意インデックス column（「表.列」の形）に当たったものか */
export function isUniqueViolation(e: unknown, column: string): boolean {
	for (let x = e; x; x = (x as { cause?: unknown }).cause) {
		const message = x instanceof Error ? x.message : String(x);
		if (message.includes('UNIQUE constraint failed') && message.includes(column)) return true;
	}
	return false;
}

const FAIL_STATUS = { validation: 400, conflict: 409, rate_limited: 429 } as const;

export async function handleAction<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (e) {
		if (!(e instanceof AppError)) throw e;
		if (e.code === 'not_found' || e.code === 'forbidden' || e.code === 'unauthorized')
			error(404, 'Not found');
		return fail(FAIL_STATUS[e.code], { message: e.message, fields: e.fields ?? {} });
	}
}

export async function handleLoad<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (isRedirect(e) || isHttpError(e) || !(e instanceof AppError)) throw e;
		if (e.code === 'not_found' || e.code === 'forbidden' || e.code === 'unauthorized')
			error(404, 'Not found');
		error(400, e.message);
	}
}
