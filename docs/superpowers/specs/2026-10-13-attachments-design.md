# ファイル添付（R2）設計書

日付: 2026-10-13
前提: `2026-10-09-project-manager-design.md`（以下「本体設計書」）の権限・データモデル・エラー処理に従う。

## 1. 目的とスコープ

課題の説明・コメントに、画面写真や仕様書などのファイルを添付できるようにする。

- 画像は Markdown 本文へ貼り付け／ドロップしてインライン表示する。
- 画像以外（PDF・Excel・zip など）も添付でき、本文にはダウンロードリンクとして挿入する。
- 課題詳細に、その課題の添付ファイル一覧を表示する。

### 制約

- 1 ファイル最大 25MB。種類は問わない。
- 1 回のアップロードは 1 ファイル（複数選択時はクライアントが順に送る）。

### 含まない

- 署名付き URL によるブラウザ→R2 直接アップロード（25MB では不要）
- 画像のサムネイル生成・リサイズ
- プロジェクト／インスタンス単位の容量上限
- 添付の差し替え（削除して再アップロードで代替）

## 2. 方式

Worker を経由して R2 バインディングに読み書きする。

```
ブラウザ ──POST multipart──▶ SvelteKit +server.ts ──put──▶ R2 (BUCKET)
ブラウザ ──GET────────────▶ SvelteKit +server.ts ──get──▶ R2
```

- 権限確認は既存の services（`requireProject` など）で行い、未参加は 404 にする。
- R2 の S3 API トークンや CORS 設定は不要。セルフホスト利用者の追加作業はバケット作成と `wrangler.jsonc` への追記だけ。
- 25MB は Workers のリクエストボディ上限（100MB）に収まる。

## 3. 設定

`wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "project-manager-attachments" }]
```

- `BaseContext` に `bucket: AttachmentStore` を追加する。`AttachmentStore` は `put / get / delete(keys[])` だけを持つ薄いインターフェースとし、本番は `R2Bucket` をそのまま渡す。単体テストはインメモリ実装を使う。
- `hooks.server.ts` で `env.BUCKET` を `locals.base.bucket` に入れる。

## 4. データモデル

### attachment

| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | UUIDv7 |
| projectId | text FK project | |
| issueId | text FK issue nullable（cascade delete） | null は「仮置き」（起票前・投稿前） |
| commentId | text FK comment nullable（set null） | コメントに紐付く場合 |
| uploaderId | text FK user（restrict） | |
| filename | text | 元のファイル名。1〜255 文字、パス区切り・制御文字は `_` に置換 |
| contentType | text | クライアント申告値。配信時の判定は §6 による |
| size | integer | バイト |
| r2Key | text unique | `<projectId>/<attachmentId>` |
| createdAt | integer | |

インデックス: `(issueId)`、`(uploaderId, issueId)`（仮置きの掃除用）。

- コメントが削除されても添付は課題に残る（`commentId` は null になる）。
- 課題の削除では行が cascade で消える。R2 の実体は §7 で削除する。

マイグレーションは 1 本（`attachment` テーブル作成）。既存テーブルは変更しない。

## 5. アップロード

`POST /projects/[key]/attachments`（multipart、フィールド `file`）

1. `requireProject` → `assertWritable`（アーカイブ中は不可）→ `authorize(actor, 'attachment:create')`（全ロール可）。
2. `file.size` が 0 または 25MB 超なら `validation` エラー（413 ではなく既存の 400 系で返す）。
3. `attachment` 行を `issueId = null` で insert → `bucket.put(r2Key, file.stream(), { httpMetadata: { contentType } })`。put に失敗したら行を削除してエラーを返す。
4. 応答: `{ id, url, filename, isImage }`。`url` は `/projects/KEY/attachments/<id>`。
5. `waitUntil` で、作成から 24 時間を過ぎた本人の仮置き添付を行・R2 とも削除する（§7）。

### 紐付け（仮置き → 課題・コメント）

起票・説明編集・コメント投稿・コメント編集の各サービスで、保存後に本文中の `/projects/KEY/attachments/<uuid>` を抽出する。該当 id のうち次の条件をすべて満たすものに `issueId`（とコメントなら `commentId`）を設定する。

- 同じ `projectId`
- `issueId IS NULL`
- `uploaderId = actor.id`

他人の仮置き添付や別プロジェクトの添付は紐付けない。

### クライアント（MarkdownEditor）

- 貼り付け（クリップボードの画像）、ドロップ、「ファイルを添付」ボタンの 3 経路でアップロードする。
- アップロード中はカーソル位置に `![アップロード中: name]()` を挿入し、完了したら置き換える。
  - 画像: `![name](url)`
  - それ以外: `[name](url)`
- 失敗したらプレースホルダを消し、トーストでエラーを表示する。
- MarkdownEditor にはアップロード先の `projectKey` を props で渡す。

## 6. 配信

`GET /projects/[key]/attachments/[id]`

- `requireProject` で参加を確認し、`attachment.projectId` が一致しなければ 404。
- R2 に実体がなければ 404。
- レスポンスヘッダ:
  - `Content-Type`: 安全な画像（`image/png` / `image/jpeg` / `image/gif` / `image/webp`）は申告値。それ以外はすべて `application/octet-stream`（申告値は使わない）。
  - `Content-Disposition`: 安全な画像は `inline`、それ以外（SVG・HTML を含む）は `attachment`。どちらも `filename*=UTF-8''<encoded>`。
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: private, max-age=3600`
- 本文の Markdown は `html: false` のまま。`![]()` が生成する `<img>` は同一オリジンの上記 URL を読むので、Cookie 認証がそのまま効く。

## 7. 削除

### 個別削除

課題詳細の添付一覧から remote command `removeAttachment` で呼ぶ（課題ページの他の操作と同じ方式）。

- 権限は `attachment:delete`。admin は全て、それ以外は `uploaderId = actor.id` の場合のみ。
- 行を削除し、`waitUntil` で `bucket.delete(r2Key)`。
- 本文中のリンクは書き換えない。削除後は 404 になり、画像は表示されなくなる。

### 課題削除

`deleteIssue` は課題を削除する前に、その課題の `r2Key` を取得する。課題削除（行は cascade）後に `waitUntil` で `bucket.delete(keys)` を呼ぶ。

### 仮置きの掃除

§5 のとおり、アップロードのたびに本人の 24 時間超の仮置きを削除する。cron は使わない（adapter-cloudflare の Worker に scheduled ハンドラを足す手間に見合わないため）。消し漏れは R2 にゴミが残るだけで、表示や権限には影響しない。

## 8. 権限

本体設計書 §3 の表に次の 2 行を追加する。`authz.ts` の `Action` にも追加する。

| 操作 | admin | member（参加 PJ） | guest（参加 PJ） |
|---|---|---|---|
| 添付のアップロード | ○ | ○ | ○ |
| 添付の削除 | 全て | 自分のもの | 自分のもの |

閲覧（ダウンロード）は課題の閲覧権限に従う。

## 9. 画面

- MarkdownEditor: 「ファイルを添付」ボタン、貼り付け・ドロップ対応、アップロード中の表示。
- 課題詳細: サイドまたは本文下に「添付ファイル」一覧を置く。各行はファイル名（リンク）・サイズ・アップロード者・日時で、権限があれば削除ボタンを表示する。一覧の対象は `issueId` が一致する全添付。

## 10. エラー処理

本体設計書 §9 の `AppError` を使う。

- 25MB 超・空ファイル・`file` なし: `validation`
- 権限なし: `forbidden`
- 未参加・存在しない: `not_found`
- R2 の put 失敗: 行をロールバックし、500 系で返す。

## 11. テスト

### 単体（vitest、インメモリ AttachmentStore）

- アップロード: guest 可、アーカイブ中は不可、25MB 超と空ファイルは拒否。
- 紐付け: 本人の仮置きだけを紐付け、他人・別プロジェクトの添付は無視する。
- 削除: admin は可、本人は可、member が他人の添付を削除すると forbidden。
- 課題削除で R2 の delete が呼ばれる。
- 24 時間を過ぎた仮置きの掃除。
- 配信時の `Content-Disposition` 判定（png は inline、svg・html は attachment）。

### E2E（Playwright）

- 新規起票で画像を貼り付け → 起票後に `<img>` が表示される。
- PDF を添付 → 添付一覧に表示され、ダウンロードできる。
- 存在しない添付 ID の URL は 404。HTML ファイルは `application/octet-stream` の `attachment` で配信される。

他プロジェクト・未参加ユーザーからの 404 は単体テストで確認する（E2E は単一シナリオで、別プロジェクトの参加者を用意しないため）。

## 12. 導入・ドキュメント

- 本番: `wrangler r2 bucket create project-manager-attachments` → Turso マイグレーション → デプロイ。
- `apps/docs` のセットアップ手順に R2 バケットの作成を追記する。
