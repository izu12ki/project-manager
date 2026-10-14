import type { WebhookProviderId } from '../../db/schema';
import type { WebhookEvent } from '../events';

/** 外部チャットサービス。新しいサービスはこれを実装してレジストリ（index.ts）に 1 行足す */
export interface WebhookProvider {
	id: WebhookProviderId;
	/** 設定画面の表示名 */
	label: string;
	/** 受け付ける URL。任意の宛先に送らせない（SSRF 対策）ため、サービスのドメインに固定する */
	urlPattern: RegExp;
	/** 送る JSON。null はこのサービスには送らない */
	build(event: WebhookEvent): unknown | null;
	/** 設定画面の「テスト送信」で送る JSON */
	buildTest(project: { key: string; name: string }): unknown;
}
