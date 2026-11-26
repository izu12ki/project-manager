import { redirect } from '@sveltejs/kit';
import type { AttachmentStore } from './attachment-store';
import type { Actor } from './authz';
import type { DB } from './db';
import type { ReadBatch } from './db/read-batch';
import type { Mailer } from './mailer';

export interface BaseContext {
	db: DB;
	/** 読み取りの batch。同じリクエストで同時に出たものを 1 往復にまとめる（db/read-batch.ts）。書き込みには使わない */
	readBatch: ReadBatch;
	mailer: Mailer;
	/** メール送信サービスを設定しているか（MAIL_PROVIDER が console 以外）。console のときもメールはログに出す */
	mailConfigured: boolean;
	bucket: AttachmentStore;
	waitUntil: (p: Promise<unknown>) => void;
	/** Slack ボットのトークン。未設定なら null（DM を送らない） */
	slackBotToken: string | null;
	/** 外部 HTTP 呼び出し（Slack API）。テストで差し替える */
	fetch: typeof fetch;
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
