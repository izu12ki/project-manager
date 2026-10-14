# 通知（アプリ内 + 外部連携）設計書

日付: 2026-10-14
前提: `2026-10-09-project-manager-design.md`（以下「本体設計書」）の権限・データモデル・エラー処理に従う。

## 1. 目的とスコープ

課題に関する出来事を関係者が見落とさないようにする。

- **アプリ内通知**: 個人宛て。サイドバーのベルに未読数を出し、`/notifications` で一覧・既読化する。
- **外部連携（Webhook）**: プロジェクト単位。プロジェクトの出来事をチャットのチャンネルへ投稿する。今回は Slack（Incoming Webhook）のみ実装するが、他サービスを 1 ファイル追加で足せる構造にする。
- **メンション**: 課題の説明・コメントで `@` から参加者を補完して挿入でき、メンションされた人に通知する。

### 含まない

- メール通知
- 期限（期限間近・期限切れ）の通知
- 個人の Slack DM（OAuth 連携）
- Slack 以外のプロバイダ（Discord / Google Chat / Teams）、汎用 Webhook（任意 URL への JSON POST。SSRF 対策が別途必要）
- Webhook 送信先ごとの出来事の選択
- 送信失敗時の再送（Cloudflare Queues は Workers 有料プラン限定のため使わない）
- 古い通知の自動削除（Cron が必要）
- リアルタイム配信（Durable Objects / WebSocket）

## 2. 出来事と配信先

| 出来事 | アプリ内通知 | Webhook |
|---|---|---|
| 課題の作成 | ―（担当者指定時は `assigned`、説明内メンションは `mentioned`） | ○ |
| 担当者の変更 | `assigned` | ○ |
| ステータスの変更 | `status_changed` | ○ |
| コメント投稿 | `commented` | ○ |
| メンション（説明・コメント） | `mentioned` | ―（コメント・作成の投稿内で `@名前` として表示） |

- 同じ status 内の並び替え（カンバンの位置だけの移動）は出来事として扱わない。
- コメントの編集・削除、課題の削除は通知しない（編集で追加されたメンションのみ §4 に従い通知する）。
- アーカイブ中のプロジェクトは更新できないため出来事は発生しない。

## 3. データモデル

### notification（新規）

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | UUIDv7 |
| userId | text FK user（restrict） | 受信者 |
| actorId | text FK user（restrict） | 操作した人 |
| issueId | text FK issue（cascade delete） | |
| type | text | `assigned` / `commented` / `status_changed` / `mentioned` |
| commentId | text FK comment nullable（cascade delete） | `commented`、およびコメント内の `mentioned` で使用 |
| fromStatus / toStatus | text nullable | `status_changed` で使用 |
| readAt | integer nullable | |
| createdAt | integer | |

インデックス: `(userId, readAt)`（未読数）、`(userId, createdAt)`（一覧）。

### project_webhook（新規）

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | UUIDv7 |
| projectId | text FK project（cascade delete） | |
| provider | text | 今回は `slack` のみ |
| url | text | 秘密情報。admin 以外には返さない |
| createdAt | integer | |

インデックス: `(projectId)`。1 プロジェクトに複数登録できる。

マイグレーションは 1 本（上記 2 テーブルの作成）。既存テーブルは変更しない。

## 4. 受信者ルール（アプリ内通知）

**関係者** = その課題の起票者 ∪ 担当者 ∪ コメントしたことがある人。

| type | 受信者 | 発生契機 |
|---|---|---|
| `assigned` | 新しい担当者 | `createIssue`（担当者指定時）、`updateIssue` で担当者が変わったとき |
| `commented` | 関係者 | `addComment` |
| `status_changed` | 関係者 | `updateIssue` / `moveIssue` で status が変わったとき |
| `mentioned` | 新たにメンションされた人 | `createIssue` / `updateIssue`（説明）、`addComment` / `editComment` |

共通ルール:

- 操作した本人には送らない。
- 担当を外したとき（担当者なしへの変更）は送らない。
- 無効化ユーザー（`disabledAt` あり）と、そのプロジェクトにアクセスできないユーザー（`project_member` にいない非 admin）には送らない。
- **1 操作 1 人 1 件**。複数の type に該当する場合は優先度 `assigned` > `mentioned` > `commented` / `status_changed` の最上位だけを作る。
  - 例: 担当とステータスを同時に変更 → 新担当者は `assigned`、他の関係者は `status_changed`。
  - 例: コメントでメンション → メンションされた人は `mentioned`、他の関係者は `commented`。
- メンションは「保存後の本文に含まれ、保存前の本文に含まれなかったユーザー ID」だけを対象にする（新規作成時は保存前を空とみなす）。

## 5. メンション

### 記法

本文には `@[表示名](user:<userId>)` の形で保存する。

- 表示名はスペースや日本語を含んでよい。`]` は挿入時に除去する。
- `<userId>` は UUIDv7 の形式（`[0-9a-f-]{36}`）に一致するものだけをメンションとみなす。
- 抽出は `extractMentionIds(text): string[]`（`src/lib/mentions.ts`、サーバー・クライアント共用）で行い、重複を除く。

### 表示

- `markdown.ts` に markdown-it のインラインルールを追加し、上記記法を `<span class="mention">@表示名</span>` に変換する（リンクにはしない）。
- 表示名は挿入時点のものを使う（後で名前が変わっても本文は書き換えない）。
- コードブロック・インラインコード内では変換しない（markdown-it のインラインルールなので自然にそうなる）。

### 入力補完（`MarkdownEditor.svelte`）

- props に `mentionCandidates?: { id: string; name: string }[]` を追加する。渡されたときだけ補完を有効にする。
- 候補は担当者候補と同じ（そのプロジェクトの `project_member` 全員と admin、無効化ユーザーを除く）。課題詳細・起票ページの load で既に取得している担当者候補を流用する。
- 行頭または空白直後の `@` に続けて入力した文字列で、名前を部分一致（大文字小文字を無視）で絞り込み、最大 8 件をキャレット位置付近のポップオーバーに出す。キャレット座標はミラー要素方式で求める。
- 操作: ↑↓ で選択、Enter / Tab で確定、Esc・空白入力・候補 0 件で閉じる。クリックでも確定できる。
- 確定すると `@` からキャレットまでを `@[名前](user:id) ` に置き換える。

### サーバー側の扱い

- 抽出した ID のうち §4 の共通ルールでアクセスできないユーザーは無視する（記法は本文に残るが通知しない）。

## 6. 構成

```
src/lib/mentions.ts                 # 記法の定義、extractMentionIds、プレーンテキスト化
src/lib/server/notifications/
  events.ts       # ProjectEvent 型（プロバイダ非依存）
  recipients.ts   # §4 の受信者計算（純粋関数 + 必要データの取得）
  in-app.ts       # notification への insert、一覧・未読数・既読化
  index.ts        # notify(ctx, event): in-app と webhook に振り分け
  webhooks/
    types.ts      # WebhookProvider インターフェース
    format.ts     # 共通の整形（抜粋、ステータス名、メンションの @名前 化）
    slack.ts      # Slack 実装
    index.ts      # providers レジストリ、deliver()
src/lib/server/services/
  notifications.ts  # 一覧・既読化・未読数（AppContext を受ける公開 API）
  webhooks.ts       # project_webhook の CRUD とテスト送信（admin のみ）
```

### ProjectEvent

```ts
type ProjectEvent = {
  project: { id: string; key: string; name: string };
  issue: { id: string; number: number; title: string; url: string };
  actor: { id: string; name: string };
} & (
  | { kind: 'issue_created'; assignee: { id: string; name: string } | null; priority: Priority; description: string }
  | { kind: 'assignee_changed'; assignee: { id: string; name: string } | null }
  | { kind: 'status_changed'; from: Status; to: Status }
  | { kind: 'commented'; comment: { id: string; body: string } }
  // 説明・コメントの編集でメンションだけが増えた場合。Webhook には送らない
  | { kind: 'mentions_added'; comment: { id: string } | null; mentionedIds: string[] }
);
```

- `updateIssue` で担当と status が同時に変わった場合は 2 つのイベントをまとめて `notify(ctx, events[])` に渡し、受信者計算で 1 人 1 件に畳む。Webhook には 2 件投稿する。
- `issue_created` / `commented` / 説明更新のメンションは本文から `extractMentionIds` で求めるため、イベントには本文（または前後の本文差分で得た ID）を持たせる。

### notify の流れ

1. services の更新処理（トランザクション）が確定した後に `await notify(ctx, events)` を呼ぶ。
2. in-app: 受信者計算 → `notification` へ一括 insert。DB 往復は「関係者・アクセス可否の取得」1〜2 回 + insert 1 回に収める。
3. webhook: `project_webhook` を取得し、各送信先について `provider.build(event)` → `deliver()` を `ctx.waitUntil` に渡す。
4. 1〜3 のどこで例外が出ても `notify` は握りつぶして `console.error` に記録する。元の操作は成功のまま返す。

### WebhookProvider

```ts
interface WebhookProvider {
  id: string;           // 'slack'
  label: string;        // 'Slack'（設定 UI の表示名）
  urlPattern: RegExp;   // 受け付ける URL。SSRF 対策を兼ねる
  build(event: ProjectEvent): unknown | null; // null は「このプロバイダには送らない」
}
```

- `deliver(fetchFn, url, body)`: JSON を POST する。`AbortSignal.timeout(5000)`。2xx 以外・タイムアウト・ネットワークエラーは `console.error` に記録し、再送しない。
- 新しいプロバイダの追加は `webhooks/<name>.ts` の作成とレジストリへの 1 行追加だけで済む。送信・ログ・設定 UI・テスト送信は共通。

### Slack 実装

- `urlPattern`: `^https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+$`
- 本文は通知欄・モバイル用のフォールバック `text` と、Block Kit の section 1 つ + context 1 つ。
- 課題タイトルは `<url|KEY-番号 タイトル>` のリンクにする。ユーザー入力（タイトル・名前・抜粋）は `&` `<` `>` をエスケープする。
- 文面:
  - 作成: `*<url|PM-12 タイトル>* を 平野 が作成しました` + context に優先度・担当者
  - 担当: `*<url|PM-12 タイトル>* の担当者を 田中 に変更しました（平野）`（外した場合は「担当者を外しました」）
  - ステータス: `*<url|PM-12 タイトル>* 未着手 → 進行中（平野）`
  - コメント: `*<url|PM-12 タイトル>* に 平野 がコメントしました` + 抜粋
- 抜粋はメンション記法を `@名前` に置き換え、Markdown 記号を除いたうえで 200 文字で切り、超えたら `…` を付ける。
- `mentions_added` は `null` を返す（送らない）。

## 7. 画面

### サイドバー（`AppSidebar.svelte`）

- ベルアイコン + 未読数バッジ（0 なら非表示、100 以上は `99+`）。`/notifications` へのリンク。
- 未読数はルートの `+layout.server.ts` で読み込む。加えて remote function `getUnreadCount`（query）を 60 秒ごとに再取得する。`document.visibilityState === 'visible'` のときだけ取得する。

### `/notifications`

- 新しい順に 50 件。各行: 操作者名、文面、`KEY-番号 タイトル`、相対時刻。未読は背景色で区別する。
- 文面: 「担当者に設定しました」「コメントしました: 抜粋…」「未着手 → 進行中」「メンションしました: 抜粋…」。抜粋は 80 文字。
- 行をクリック → `markRead(id)` → 課題詳細へ遷移。`commentId` があれば `#comment-<id>` へスクロール（課題詳細のコメント要素に該当 id が無ければ付ける）。
- 「すべて既読にする」ボタン → `markAllRead()`。
- 自分宛て以外の通知 ID を指定した既読化は `not_found`。

### 課題詳細

- 表示時（load）に、その課題に関する自分宛ての未読通知をまとめて既読にする。

### プロジェクト設定 `/projects/[key]/settings`（admin のみ）

- 「外部連携」セクション: 登録済み送信先の一覧（プロバイダ名、マスクした URL = 末尾 6 文字以外を `•` に置換）。
- 「追加」: プロバイダを選択（今回は Slack のみ）+ URL 入力。`urlPattern` に合わなければフィールドエラー。
- 各行に「テスト送信」「削除」。テスト送信だけは結果を待ち、成功・失敗（ステータスコード）を表示する。
- 常時表示する注意書き: 「課題のタイトルとコメントの抜粋がこのチャンネルに投稿されます。ゲストに見せたくない内容がある場合はチャンネルの参加者に注意してください。」

## 8. 権限

| 操作 | admin | member | guest |
|---|---|---|---|
| 自分宛て通知の閲覧・既読化 | ○ | ○ | ○ |
| Webhook の閲覧・追加・削除・テスト送信 | ○ | × | × |
| メンションの挿入 | ○ | ○ | ○ |

本体設計書 3 章の表に追記する。`authz.ts` に `webhook:manage` を追加する。

## 9. テスト

### Vitest（services 層、`:memory:` DB）

- 受信者計算をテーブル駆動で網羅: 本人除外、1 人 1 件と優先度、担当外し、無効化ユーザー、非参加者、admin、関係者の各経路（起票者・担当者・コメント者）。
- `createIssue` / `updateIssue` / `moveIssue` / `addComment` / `editComment` が期待どおりの `notification` 行を作ること。並び替えだけの `moveIssue` では作らないこと。
- メンション: 新規追加分だけが通知されること、編集で既存メンションが再通知されないこと、アクセスできないユーザーの ID は無視されること。
- `notify` 内部の失敗（insert 失敗・webhook 取得失敗）でも元の操作が成功すること。
- `project_webhook`: admin 以外の追加・削除・一覧が `forbidden`、URL パターン検証、admin 以外に URL を返さないこと。
- `notifications` services: 自分宛て以外の既読化が `not_found`、未読数、`markAllRead`、課題詳細表示での既読化。
- `extractMentionIds` と markdown のメンション描画（コード内で変換しないことを含む）。
- Slack `build()` の出力をスナップショットで検証（エスケープ、抜粋の切り詰め、メンションの `@名前` 化を含む）。
- `deliver()`: `fetch` をモックし、成功・2xx 以外・タイムアウトで例外を投げずにログすること。

### E2E（Playwright）

既存シナリオに追加: member が guest を担当者にする → guest のバッジに 1 → `/notifications` から課題へ遷移 → バッジが消える。member がコメントで `@` 補完から guest をメンション → guest に `mentioned` が届く。Slack への実送信は行わない。

## 10. ドキュメント

- 機能一覧に通知・Slack 連携・メンションを追記。
- 「Slack 連携」ページ: Slack 側で Incoming Webhook を作成する手順、設定画面での登録とテスト送信、投稿される内容とゲストへの注意。
- 権限の表を更新。
