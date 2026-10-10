import { redirect } from '@sveltejs/kit';
import type { Actor } from './authz';
import type { DB } from './db';
import type { Mailer } from './mailer';

export interface BaseContext {
	db: DB;
	mailer: Mailer;
	waitUntil: (p: Promise<unknown>) => void;
	baseUrl: string;
	hashPassword: (password: string) => Promise<string>;
	/** リクエスト内で読み取り結果を共有するキャッシュ。未指定ならキャッシュしない。 */
	memo?: Map<string, Promise<unknown>>;
}

export interface AppContext extends BaseContext {
	actor: Actor;
}

export function appContext(locals: { base: BaseContext; user: Actor | null }): AppContext {
	if (!locals.user) redirect(303, '/login');
	return { ...locals.base, actor: locals.user };
}
