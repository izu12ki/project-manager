# プロジェクト管理ツール（OSS）設計書

- 日付: 2026-10-09
- ステータス: レビュー待ち

## 1. 目的と前提

受託開発会社が、社内メンバーと顧客（ゲスト）でプロジェクトの課題を共有するための OSS プロジェクト管理ツール。
利用者は自分の Cloudflare アカウントにセルフホストする。マネージド SaaS は提供しない。

### 決定事項

| 項目 | 決定 |
|---|---|
| ランタイム | Cloudflare Workers（Static Assets） |
| DB | Turso（libSQL）、`@libsql/client/web` で HTTP 接続 |
| ORM | Drizzle ORM v1.0.0-rc.4 以上 / drizzle-kit |
| フロント + バックエンド | SvelteKit 単体（`@sveltejs/adapter-cloudflare`） |
| スタイル | Tailwind CSS v4 |
| アイコン | `@lucide/svelte` |
| 認証 | better-auth（メールアドレス + パスワードのみ） |
| メール | HTTP API 経由。SMTP2GO / Resend / console を切替 |
| バリデーション | Valibot |
| ドキュメント | Astro Starlight |
| ツール | pnpm（workspace）, mise |
| ライセンス | MIT |
| テナント | 1 デプロイ = 1 社 |

### バックエンドに Hono を採用しない理由

MVP には外部向け API の需要がなく、1 Worker・1 デプロイで済む SvelteKit 単体がセルフホスト利用者の負担が最小。
業務ロジックを `src/lib/server/services/`（フレームワーク非依存の TypeScript）に閉じ込めておき、
将来 REST API が必要になったら `src/routes/api/[...path]/+server.ts` に Hono を載せて services を呼ぶ。

### MVP スコープ

含む: 課題管理（作成・担当者・期限・ステータス・優先度）、カンバン、課題へのコメント、ゲスト招待と権限制御、招待/パスワードリセットのメール送信。

含まない（将来）: ガントチャート/マイルストーン、ファイル添付（R2）、工数記録、Wiki、通知、ステータスのカスタマイズ、外部 REST API、マルチ組織。

## 2. リポジトリ構成

```
project-manager/
├─ mise.toml                 # node(LTS), pnpm のバージョン固定
├─ pnpm-workspace.yaml
├─ package.json              # ルートスクリプト（lint, test, dev など）
├─ LICENSE                   # MIT
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ hooks.server.ts
│  │  │  ├─ lib/server/
│  │  │  │  ├─ db/           # schema.ts, client.ts
│  │  │  │  ├─ auth.ts       # better-auth 設定
│  │  │  │  ├─ mailer/       # index.ts(interface/factory), smtp2go.ts, resend.ts, console.ts
│  │  │  │  ├─ services/     # projects, issues, comments, members, invitations, users, setup
│  │  │  │  ├─ authz.ts      # authorize(actor, action, resource)
│  │  │  │  └─ errors.ts     # AppError と action/load 用変換
│  │  │  └─ routes/
│  │  ├─ drizzle/            # マイグレーション SQL
│  │  ├─ drizzle.config.ts
│  │  └─ wrangler.jsonc
│  └─ docs/                  # Astro Starlight
└─ .github/workflows/ci.yml
```

共有パッケージは作らない。

### 環境変数 / シークレット

| 名前 | 必須 | 説明 |
|---|---|---|
| `TURSO_DATABASE_URL` | ○ | `libsql://...` |
| `TURSO_AUTH_TOKEN` | ○（本番） | Turso の DB トークン |
| `BETTER_AUTH_SECRET` | ○ | 32 バイト以上のランダム値 |
| `BETTER_AUTH_URL` | ○ | 公開 URL（例 `https://pm.example.com`） |
| `MAIL_PROVIDER` | - | `smtp2go` / `resend` / `console`（未設定時 `console`） |
| `MAIL_API_KEY` | provider が console 以外なら ○ | |
| `MAIL_FROM` | provider が console 以外なら ○ | 例 `PM <noreply@example.com>` |

## 3. 権限

インスタンス全体のロールを `user.role`（better-auth の additionalFields）で持つ。プロジェクトへの参加は `project_member` で管理する（admin は全プロジェクトに参加扱い）。

| 操作 | admin | member（参加 PJ） | guest（参加 PJ） |
|---|---|---|---|
| ユーザー招待・無効化 | ○ | × | × |
| プロジェクト作成・編集・アーカイブ | ○ | × | × |
| 参加者の追加・削除、guest 招待 | ○ | × | × |
| プロジェクト・課題・コメントの閲覧 | ○ | ○ | ○ |
| 課題の起票 | ○ | ○ | ○ |
| 課題のタイトル・説明・優先度・期限の編集 | ○ | ○ | 自分が起票した課題のみ |
| 課題のステータス変更（カンバン移動を含む） | ○ | ○ | 自分が担当者の課題のみ |
| 課題の担当者変更 | ○ | ○ | × |
| 課題の削除 | ○ | ○ | × |
| コメント投稿 | ○ | ○ | ○ |
| コメント編集・削除 | 全て | 自分のもの | 自分のもの |

- 担当者候補はその課題のプロジェクトの `project_member` 全員（guest を含む）と admin。
- guest が起票した課題は `status = todo`、担当者なしで作成される。guest は起票時に担当者を指定できない。
- 未参加プロジェクトやその配下へのアクセスは 404 を返す（存在を隠す）。
- 無効化されたユーザー（`disabledAt` あり）は全セッションを破棄し、ログイン不可。

## 4. データモデル

ID は UUIDv7 の text。日時は integer（ms epoch、Drizzle の `timestamp_ms` モード）。

### better-auth 標準

`user` / `session` / `account` / `verification`。`user` に以下を追加:

- `role`: text, `'admin' | 'member' | 'guest'`, not null
- `disabledAt`: integer, nullable

### invitation

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | |
| email | text | 小文字に正規化 |
| role | text | `'member' \| 'guest'` |
| projectId | text FK nullable | guest は必須。member は任意（指定時はそのPJへ参加させる） |
| tokenHash | text unique | SHA-256(token) の hex |
| invitedBy | text FK user | |
| expiresAt | integer | 発行から 7 日 |
| acceptedAt | integer nullable | |
| createdAt | integer | |

同じ email の未使用招待を再発行した場合、古い招待は削除する。既に登録済みの email への招待は `conflict`。

### project

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | |
| key | text unique | `^[A-Z][A-Z0-9]{1,9}$`、作成後変更不可 |
| name | text | |
| description | text | Markdown、空可 |
| nextIssueNumber | integer | 初期値 1 |
| archivedAt | integer nullable | アーカイブ中は閲覧のみ可能 |
| createdAt / updatedAt | integer | |

### project_member

`(projectId, userId)` 複合 PK、`createdAt`。

### issue

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | |
| projectId | text FK | |
| number | integer | `(projectId, number)` unique。表示は `KEY-number` |
| title | text | 1〜200 文字 |
| description | text | Markdown、最大 50,000 文字 |
| status | text | `todo` / `in_progress` / `in_review` / `done` |
| priority | text | `none` / `low` / `medium` / `high` / `urgent` |
| assigneeId | text FK nullable | |
| reporterId | text FK | |
| dueDate | text nullable | `YYYY-MM-DD` |
| position | text | fractional index（同一 status 内の並び順） |
| createdAt / updatedAt | integer | |

インデックス: `(projectId, status, position)`、`(assigneeId)`。

採番: トランザクション内で `UPDATE project SET nextIssueNumber = nextIssueNumber + 1 WHERE id = ? RETURNING nextIssueNumber - 1` を実行し、その値で insert する。

### comment

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | |
| issueId | text FK（cascade delete） | |
| authorId | text FK | |
| body | text | Markdown、1〜20,000 文字 |
| createdAt / updatedAt | integer | |

ユーザーは削除せず無効化のみ行うため、`user` への FK は restrict。

## 5. 画面

| パス | 内容 | 権限 |
|---|---|---|
| `/setup` | 最初の admin 作成。ユーザーが 1 人以上いれば `/login` へリダイレクト | 未ログイン |
| `/login` | ログイン | 未ログイン |
| `/forgot-password` / `/reset-password` | パスワードリセット | 未ログイン |
| `/invite/[token]` | 招待の受諾（名前とパスワードを設定）。無効・期限切れなら案内を表示 | 未ログイン |
| `/` | 参加プロジェクト一覧（アーカイブは折りたたみ） | 全員 |
| `/projects/[key]` | 課題一覧。status / 担当者 / 優先度で絞り込み、URL クエリに保持 | 参加者 |
| `/projects/[key]/board` | カンバン（status 4 列、ドラッグで移動・並び替え） | 参加者 |
| `/projects/[key]/issues/new` | 課題の起票 | 参加者 |
| `/projects/[key]/issues/[number]` | 課題の詳細・編集・コメント | 参加者 |
| `/projects/[key]/settings` | PJ 情報、参加者の追加・削除、guest 招待 | admin |
| `/admin/users` | ユーザー一覧、招待（member/guest）、招待リンクのコピー、無効化 | admin |
| `/admin/projects/new` | プロジェクト作成 | admin |
| `/account` | 表示名・パスワードの変更 | 全員 |

UI 上の表示や操作の出し分けは services 層の権限判定と同じ関数（`can(actor, action, resource)`）を使う。ただし最終的な強制は常にサーバー側で行う。

## 6. データの流れ

- `hooks.server.ts`:
  1. better-auth の `svelteKitHandler` で `/api/auth/*` を処理する。
  2. セッションを取得して `locals.user` / `locals.session` に入れる。
  3. 未ログインで保護ルートにアクセスした場合は `/login?redirectTo=...` へ。
  4. `disabledAt` のあるユーザーはセッションを破棄して `/login` へ。
- DB クライアントはリクエストごとに `platform.env` から生成する（グローバルに状態を持たない）。
- 読み込みは `+page.server.ts` の `load` → `services.*(ctx, ...)`。
- 更新は form actions → `services.*(ctx, ...)`。`use:enhance` で進行的に強化し、JavaScript 無効でも動く。
- `ctx` は `{ db, actor, mailer, waitUntil }`。
- カンバンの移動は `?/move` action を `fetch` で呼ぶ（`{ issueId, status, beforeId, afterId }`）。サーバー側で fractional index を計算する。クライアントは楽観的に更新し、失敗したら元に戻してトーストを表示する。ドラッグ処理は `svelte-dnd-action`。
- Markdown はサーバー側で `markdown-it`（`html: false`, `linkify: true`）により HTML 化する。外部リンクには `rel="noopener noreferrer nofollow"` を付ける。

## 7. 認証

- better-auth 設定: `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 }`、Drizzle アダプタ（sqlite）、rate limit 有効（storage: database）。
- `/setup`: services 内のトランザクションで「`user` が 0 件」を確認してからユーザーを作成し、`role = admin` にする。better-auth の公開サインアップ API は使わず、サーバー内部から作成する。作成方法（`auth.api` 経由か `ctx.password.hash` を使った直接 insert か）は実装時に better-auth のドキュメントで確認し、`disableSignUp` と両立する方法を選ぶ。
- `/invite/[token]`: token をハッシュして `invitation` を検索 → 有効性（未使用・期限内）を確認 → ユーザー作成（role は招待のもの）→ `projectId` があれば `project_member` に追加 → `acceptedAt` を設定。ここまでを 1 トランザクションで行い、完了後にログイン状態にする。
- 招待トークン: `crypto.getRandomValues` で 32 バイト → base64url。DB にはハッシュのみ保存する。
- パスワードリセット: better-auth の `sendResetPassword` コールバックから Mailer を呼ぶ。

## 8. メール

```ts
interface Mailer {
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}
```

- `createMailer(env)` が `MAIL_PROVIDER` に応じて実装を返す。
  - `smtp2go`: `POST https://api.smtp2go.com/v3/email/send`
  - `resend`: `POST https://api.resend.com/emails`
  - `console`: 内容を `console.log` に出力するだけ
- 送信は `ctx.waitUntil` で行い、レスポンスを遅らせない。失敗しても業務処理は失敗させず、ログに残す。
- 招待はメールが届かなくても使えるよう、`/admin/users` と `/projects/[key]/settings` に未使用招待の一覧と「招待リンクをコピー」を常に表示する。トークンはハッシュしか持たないため、コピーするには招待を再発行する（旧リンクは無効化される）。
- 無料枠（2026-10 時点、ドキュメントに記載する）: SMTP2GO は月 1,000 通・日 200 通、Resend は月 3,000 通・日 100 通。
- テンプレートは日本語と英語の 2 言語をコード内に定義する（i18n 基盤は MVP では導入しない。UI は日本語のみ）。

## 9. エラー処理

- services は `AppError(code, message, fields?)` を投げる。`code` は `not_found` / `forbidden` / `validation` / `conflict`。
- 共通ラッパー:
  - action 内: `validation` / `conflict` → `fail(400 / 409, { message, fields })`、`not_found` / `forbidden` → `error(404)`
  - load 内: `not_found` / `forbidden` → `error(404)`、その他 → `error(400)`
- 想定外の例外は `handleError` でログに出し、利用者には汎用メッセージを返す。
- 入力は Valibot スキーマで検証し、フィールドごとのエラーをフォームに返す。

## 10. テスト

- services 層（Vitest）: `@libsql/client` の `:memory:` DB にマイグレーションを流してから実行する。
  - 権限の表（3 章）を admin / member / guest / 未参加者 × 各操作でテーブル駆動に網羅する。
  - 採番の連番性、招待の有効期限・再利用不可、`/setup` の 2 回目拒否、fractional index による並び順。
- Mailer: `fetch` をモックし、各プロバイダのリクエスト形式を検証する。
- E2E（Playwright）: setup → member と guest を招待 → guest が起票 → member が guest を担当者に割り当て → guest がカンバンで移動 → guest がコメント、の 1 本。ローカルの `turso dev` + `vite dev` に対して実行する。

## 11. CI

GitHub Actions（push / PR）: `jdx/mise-action` → `pnpm install --frozen-lockfile` → ESLint + Prettier → `svelte-check` → Vitest → Playwright → `apps/docs` のビルド。自動デプロイは行わない。

## 12. ドキュメント（apps/docs）

Starlight で以下のページを用意する（MVP では日本語のみ）。

- はじめに: 概要、スクリーンショット、機能
- **必要なもの**: Cloudflare アカウント（必須、Workers 無料プランで動作）、Turso アカウント（必須）、SMTP2GO または Resend のアカウント（任意）、Node / pnpm / mise
- デプロイ手順: リポジトリの取得 → Turso の DB とトークンの作成 → `wrangler login` → `wrangler secret put` で各シークレットを登録 → `pnpm db:migrate` → `pnpm deploy` → `/setup` で admin を作成
- メール設定: SMTP2GO / Resend の登録、送信元ドメインの認証、無料枠
- 権限の表、環境変数の一覧
- アップデート手順（pull → migrate → deploy）
- ローカル開発、コントリビュートの方法
- ドキュメントサイト自体を Cloudflare Workers の Static Assets で公開する手順

## 13. デプロイ

- `apps/web`: `pnpm --filter web deploy` = `vite build && wrangler deploy`
- マイグレーションは Worker から実行せず、`pnpm --filter web db:migrate`（drizzle-kit migrate、Turso に接続）を手動または CI で実行する。
