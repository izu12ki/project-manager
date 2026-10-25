import type { IntegrationProviderId, NotificationType } from '../../db/schema';

export interface ChannelConfig {
	fetch: typeof fetch;
	token: string;
}

export type LookupResult =
	| { ok: true; externalId: string }
	/** not_found: その人が見つからない / config: トークン・権限・通信の問題 */
	| { ok: false; reason: 'not_found' | 'config'; error: string };

export type SendResult = { ok: true } | { ok: false; error: string };

/** プロバイダに渡す解決済みの 1 通。1 行目は headline() で作る */
export interface DirectMessage {
	type: NotificationType;
	actor: { name: string };
	/** key は "ACME-12"。まとめ通知ではプロジェクト（key = "ACME"、title = プロジェクト名、url = 課題一覧） */
	issue: { key: string; title: string; url: string };
	/** まとめ通知の課題数 */
	count?: number;
	/** 2 行目。空なら出さない */
	detail: string;
}

/** 個人宛ての外部通知先。新しいサービスはこれを実装して index.ts に 1 行足す */
export interface UserChannelProvider {
	id: IntegrationProviderId;
	label: string;
	/** メールアドレスから相手を特定する。例外は投げない */
	lookup(cfg: ChannelConfig, email: string): Promise<LookupResult>;
	/** 1 件の通知を送る。例外は投げない */
	send(cfg: ChannelConfig, externalId: string, m: DirectMessage): Promise<SendResult>;
	/** オンにした直後の確認メッセージ。例外は投げない */
	sendWelcome(cfg: ChannelConfig, externalId: string): Promise<SendResult>;
}
