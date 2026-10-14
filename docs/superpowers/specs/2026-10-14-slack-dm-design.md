# Slack 個人通知（DM）設計書

日付: 2026-10-14
前提: `2026-10-14-notifications-design.md`（以下「通知設計書」）。本書はその「外部連携（Webhook）」を置き換える。アプリ内通知・メンション・受信者ルールは通知設計書のまま。

## 1. 目的とスコープ

Slack の Backlog アプリのように、**自分に関わる出来事だけ**を Slack の DM で受け取れるようにする。届く出来事はアプリ内通知と同じ（担当になった・関わる課題へのコメント・ステータス変更・メンション）。

- 各ユーザーが個人設定で Slack 通知をオンにする（初期値オフ）。
- ワークスペースに 1 つの Slack アプリ（ボット）を入れ、ボットが各人へ DM する。
- ユーザーと Slack アカウントは **メールアドレスの一致** で結びつける。前提であることを画面とドキュメントに明記する。

### 含まない

- プロジェクト単位のチャンネル投稿（Webhook）。実装済みのものは削除する
- 出来事の種類ごとのオン／オフ
- Slack メンバー ID の手入力、OAuth による「Slack と連携」ボタン、複数ワークスペース
- Slack 以外のサービス（構造は足せるようにしておく）
- 送信失敗時の再送、送信失敗による自動の連携解除

## 2. Slack 側の準備（管理者・一度だけ）

1. Slack アプリ（Blank app）の「OAuth & Permissions」で Bot Token Scopes に `chat:write`, `users:read`, `users:read.email` を付ける。
2. ワークスペースにインストールし、`xoxb-…` の Bot User OAuth Token を控える。
3. 「App Home」の Messages Tab を有効にする（ユーザーがボットとの DM を見られるようにする）。
4. Worker のシークレットに設定する: `wrangler secret put SLACK_BOT_TOKEN`（本番）と `wrangler secret put SLACK_BOT_TOKEN --env preview`。ローカルは `.dev.vars`。

Incoming Webhook は使わない。

## 3. 設定値

- `env.ts` に `SLACK_BOT_TOKEN: v.optional(v.string())` を足す。`.dev.vars.example` に空の行を足す。
- `BaseContext` に `slackBotToken: string | null` を足す（空文字は null 扱い）。
- 未設定のとき: 個人設定の Slack 項目は「Slack 連携は未設定です（管理者に連絡してください）」と表示してスイッチを無効化し、送信処理は何もしない。

## 4. データモデル

### user_integration（新規）

| 列 | 型 | 説明 |
|---|---|---|
| `user_id` | text, FK → `user.id` ON DELETE CASCADE | |
| `provider` | text enum `['slack']` | 連携先サービス |
| `external_id` | text, not null | Slack のユーザー ID（`U…`） |
| `created_at` | integer (timestamp) | |

- 主キー `(user_id, provider)`。行があればオン、なければオフ。オフにしたら行を削除する。
- Slack 側のメールアドレスが変わった場合は、オンにし直すと ID を引き直す。

### 削除

- `project_webhook` テーブル。プレビュー DB には適用済みなので既存マイグレーションは書き換えず、**`DROP TABLE project_webhook` と `user_integration` 作成を行うマイグレーションを 1 本追加**する。本番 DB には未適用のため影響なし。
- 権限 `webhook:manage`。

## 5. 構成

```
src/lib/server/notifications/
  index.ts            notify: 受信者計算 → notification 挿入 → DM 送信
  recipients.ts       変更なし
  channels/
    types.ts          UserChannelProvider
    index.ts          providers レジストリ（今は slack のみ）
    slack.ts          Slack 実装
src/lib/server/services/integrations.ts   連携のオン／オフ（個人設定から呼ぶ）
```

`notifications/webhooks/`、`services/webhooks.ts`、`WebhookEvent`、`toWebhookEvent` は削除する。

### UserChannelProvider

```ts
interface UserChannelProvider {
  id: IntegrationProviderId;            // 'slack'
  label: string;                        // 'Slack'
  /** メールアドレスから相手を特定する */
  lookup(cfg: ChannelConfig, email: string): Promise<LookupResult>;
  /** 1 件の通知を送る。例外は投げない */
  send(cfg: ChannelConfig, externalId: string, message: DirectMessage): Promise<SendResult>;
}
type LookupResult = { ok: true; externalId: string } | { ok: false; reason: 'not_found' | 'config' ; error: string };
type SendResult = { ok: true } | { ok: false; error: string };
```

`ChannelConfig` は `{ fetch, token }`。`DirectMessage` はプロバイダ非依存の解決済みメッセージ:

```ts
interface DirectMessage {
  type: NotificationType;               // assigned | mentioned | commented | status_changed
  actor: { name: string };
  issue: { key: string; title: string; url: string };   // key = "PM-12"
  detail: string;                       // 2 行目（空なら出さない）
}
```

### Slack 実装

- `lookup`: `GET https://slack.com/api/users.lookupByEmail?email=…`（`Authorization: Bearer <token>`）。`ok: true` → `user.id`。`error === 'users_not_found'` → `not_found`。それ以外（`invalid_auth`, `missing_scope`, `not_authed`, HTTP エラー, タイムアウト）→ `config`。
- `send`: `POST https://slack.com/api/chat.postMessage`、JSON `{ channel: externalId, text, blocks }`。HTTP 200 でも `ok: false` なら失敗として `error` を返す。
- タイムアウト 5 秒、再送なし。
- 文面の 1 行目と 2 行目は §6。mrkdwn の `& < >` はエスケープする（既存 `esc` を流用）。
- 確認 DM（オンにした直後）: 「プロジェクト管理の通知をここで受け取ります。」

### notify の流れ

1. 従来どおり `planNotifications` で受信者ごとに 1 件を決め、`notification` に挿入する。
2. `slackBotToken` が null、または planned が空なら終わり。
3. planned の userId で `user_integration`（provider = slack）を 1 回で引く。
4. 該当者ごとに `DirectMessage` を組み立て、`ctx.waitUntil` で並列に `send` する。失敗は `console.error('[dm] slack <userId>: <error>')` のみ。
5. 全体を try/catch し、失敗しても元の操作には影響させない（従来どおり）。

## 6. 文面

| type | 1 行目 | 2 行目 |
|---|---|---|
| `assigned` | 〇〇さんが あなたを担当者に設定 しました。 | 優先度: 高 |
| `mentioned` | 〇〇さんが あなたを メンション しました。 | メンションを含むコメント、または説明の先頭 200 文字 |
| `commented` | 〇〇さんが コメント しました。 | コメントの先頭 200 文字 |
| `status_changed` | 〇〇さんが ステータスを変更 しました。 | 未対応 → 処理中 |

- 1 行目の下に課題リンク `*<url|PM-12 課題タイトル>*`。
- `commentId` がある通知はリンクを `…/issues/12#comment-<id>` にする。
- 通知テキスト（`text`、通知のプレビューに出る）は「1 行目 + PM-12 課題タイトル」。
- 抜粋は既存の `excerpt(…, 200)`。2 行目に必要な本文・優先度は notify の入力（`IssueEvent`）から取る。

## 7. 画面

### 個人設定 `/account` に「Slack 通知」セクション

- 説明文: 「このアプリのログイン用メールアドレス（<本人のメールアドレス>）と同じメールアドレスの Slack アカウントに、DM で通知が届きます。Slack のプロフィールのメールアドレスが異なる場合は届きません。」
- スイッチ（オン／オフ）。オン中は「Slack に連携中」と表示。
- オンにする操作:
  - 見つかった → 保存し、確認 DM を送る。成功メッセージ「Slack 通知をオンにしました。Slack に確認のメッセージを送りました。」
  - `not_found` → オフのまま「Slack に <メールアドレス> のアカウントが見つかりませんでした。Slack のプロフィールのメールアドレスを確認してください。」
  - `config` → オフのまま「Slack 連携の設定に問題があります。管理者に連絡してください。」、詳細はログ。
  - 確認 DM の送信失敗は、保存は維持してログのみ（lookup が通っていれば通常は届く）。
- オフにする操作: 行を削除するだけ。
- ゲストを含む全ユーザーが操作できる（自分の連携のみ）。

### 削除

- プロジェクト設定の「外部連携」タブ。

## 8. 権限

- 連携のオン／オフは本人のみ（ログインしていれば可）。他人の連携は操作できない。
- `webhook:manage` を削除し、ドキュメントの権限表からも消す。

## 9. テスト

### Vitest

- Slack 実装: `lookup` の成功／`users_not_found`／`invalid_auth`／HTTP エラー、`send` の `ok: false` を失敗として返す、文面（4 種、コメントへのリンク、エスケープ）。`fetch` は偽物に差し替える。
- services/integrations: オンで保存＋確認 DM、`not_found` で保存しない、オフで削除、トークン未設定ならエラー。
- notify: オンにしている planned 受信者にだけ送る、操作した本人には送らない、トークン未設定なら送らない、送信失敗でも notification は残る。
- 既存の Webhook 関連テストは削除する。

### E2E

- `/account` に説明文（メールアドレスの一致が前提である旨）が出る。E2E 環境はトークン未設定なので、スイッチが無効で「未設定です」が出る。
- 既存の Webhook 設定の E2E は削除する。

## 10. ドキュメント

- `guides/slack.md` を書き換える: 管理者の準備（§2）と、各ユーザーの設定（メールアドレスの一致が前提であることを明記）。
- 権限表から Webhook の行を削除する。
- 通知設計書の冒頭に「外部連携は本書（Slack 個人通知）で置き換え」と追記する。
