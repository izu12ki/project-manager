# Project Manager API リファレンス

## 共通

- ベース URL: `$PM_API_URL/api/v1`
- 認証: `Authorization: Bearer <API キー>`。API キーは管理者（アカウント設定の「API キー」カード）だけが発行でき、`pm_` で始まる。Cookie のセッションでは呼べない。
- 本文は JSON（`Content-Type: application/json`）。日付は `YYYY-MM-DD`、日時は ISO 8601。
- プロジェクトキーは大文字小文字を区別せず、サーバーが大文字にそろえる。課題は `PROJ-12` の形で表し、パスでは `/projects/PROJ/issues/12` のように番号で指定する。
- 応答の人は `{ "id": "...", "name": "..." }` だけで、メールアドレスは含まれない。
- 変更履歴、通知、報告者は、API キーの持ち主として記録される。
- `PATCH` は送った項目だけを変える。`null` はその項目を空にする。項目を省くと変更しない。

## レート制限

API キーごとに 1 分あたり 120 リクエスト。超えると 429（`rate_limited`）を返す。

## エラー

```json
{
  "error": {
    "code": "validation",
    "message": "1 件の課題に入力エラーがあります。何も書き込んでいません",
    "fields": { "items.0.dueDate": ["開始日は期限日以前の日付にしてください"] }
  }
}
```

`fields` は入力エラーのときだけ付く。値は項目ごとの理由（日本語）の配列。

| HTTP | code           | 意味                                                           |
| ---- | -------------- | -------------------------------------------------------------- |
| 400  | `validation`   | 入力が不正。JSON の形式エラーも含む                            |
| 401  | `unauthorized` | API キーが無い、無効、失効、または持ち主が管理者でない         |
| 403  | `forbidden`    | 権限がない                                                     |
| 404  | `not_found`    | プロジェクトや課題が見つからない（見えないプロジェクトも同じ） |
| 409  | `conflict`     | 競合                                                           |
| 429  | `rate_limited` | レート制限                                                     |
| 500  | `internal`     | サーバーエラー（詳細は返さない）                               |

## GET /me

接続確認。キーの持ち主を返す。

```bash
curl -sS "$PM_API_URL/api/v1/me" -H "Authorization: Bearer $PM_API_KEY"
```

```json
{ "id": "u1", "name": "平野", "role": "admin" }
```

## GET /projects

見えるプロジェクトの一覧。

```json
{
  "projects": [
    {
      "key": "PROJ",
      "name": "サンプル",
      "archived": false,
      "url": "https://.../projects/PROJ"
    }
  ]
}
```

## GET /projects/{key}

プロジェクト詳細。起票・更新で指定する ID とステータスのキーはここで取る。

```json
{
  "key": "PROJ",
  "name": "サンプル",
  "archived": false,
  "url": "https://.../projects/PROJ",
  "description": "...",
  "timelineUrl": "https://.../projects/PROJ/timeline",
  "statuses": [{ "key": "todo", "name": "未対応" }],
  "types": [{ "id": "t1", "name": "タスク" }],
  "categories": [{ "id": "c1", "name": "設計" }],
  "milestones": [
    {
      "id": "m1",
      "name": "v1",
      "releaseDate": "2026-12-01",
      "completed": false
    }
  ],
  "members": [{ "id": "u1", "name": "平野" }]
}
```

- `milestones[].releaseDate` は `null` になりうる。`completed: true` のマイルストーンは新しく割り当てられない。
- `members` は担当者に指定できる人。

## GET /projects/{key}/issues

課題の一覧（番号の新しい順。削除済みは含まない）。

| クエリ        | 意味                                                                |
| ------------- | ------------------------------------------------------------------- |
| `status`      | ステータスのキー（`todo` など）                                     |
| `assigneeId`  | 担当者の ID。`none` で未担当                                        |
| `typeId`      | 課題種別の ID。`none` で未設定                                      |
| `categoryId`  | カテゴリーの ID。`none` で未設定                                    |
| `milestoneId` | マイルストーンの ID。`none` で未設定                                |
| `q`           | タイトルの部分一致。`PROJ-12`、`#12`、`12` は番号の一致としても扱う |
| `limit`       | 1〜500。既定 100                                                    |
| `offset`      | 0 以上。既定 0                                                      |

`limit` と `offset` が範囲外のときは 400。

```json
{
  "items": [
    {
      "key": "PROJ-12",
      "number": 12,
      "title": "ログイン画面",
      "typeId": "t1",
      "status": "todo",
      "resolution": null,
      "priority": "none",
      "assignee": { "id": "u1", "name": "平野" },
      "startDate": "2026-11-01",
      "dueDate": "2026-11-10",
      "categoryId": null,
      "milestoneId": null,
      "url": "https://.../projects/PROJ/issues/12",
      "updatedAt": "2026-10-25T01:23:45.000Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

`total` は絞り込み後の全件数。一覧の要素には `description` を含めない。

## GET /projects/{key}/issues/{number}

課題詳細。一覧の要素と同じ項目に、`description`（Markdown）が加わる。削除された課題は 404。

## POST /projects/{key}/issues

1 件起票する。成功すると 201 で、作成した課題（詳細と同じ形）を返す。

```bash
curl -sS -X POST "$PM_API_URL/api/v1/projects/PROJ/issues" \
  -H "Authorization: Bearer $PM_API_KEY" -H "Content-Type: application/json" \
  -d '{"title":"ログイン画面","startDate":"2026-11-01","dueDate":"2026-11-10","assigneeId":"u1"}'
```

## PATCH /projects/{key}/issues/{number}

1 件更新する。送った項目だけを変え、更新後の課題（詳細と同じ形）を 200 で返す。

```bash
curl -sS -X PATCH "$PM_API_URL/api/v1/projects/PROJ/issues/12" \
  -H "Authorization: Bearer $PM_API_KEY" -H "Content-Type: application/json" \
  -d '{"dueDate":"2026-11-20","assigneeId":null}'
```

## POST /projects/{key}/issues/bulk

一括起票。リクエストは `{ "items": [ <起票の項目>, ... ] }`。

```json
{
  "items": [
    { "title": "設計", "startDate": "2026-11-01", "dueDate": "2026-11-05" },
    {
      "title": "実装",
      "startDate": "2026-11-06",
      "dueDate": "2026-11-20",
      "assigneeId": "u1"
    }
  ]
}
```

応答は 201 で、作られた課題の番号を `items` の順に返す。

```json
{ "numbers": [13, 14] }
```

## PATCH /projects/{key}/issues/bulk

一括更新。各要素に `number`（1 以上の整数）と変更する項目を入れる。

```json
{
  "items": [
    { "number": 13, "dueDate": "2026-11-08" },
    { "number": 14, "status": "in_progress" }
  ]
}
```

応答は 200 で `{ "numbers": [13, 14] }`（指定した順）。値が変わらない要素があっても、番号は返る。

### 一括の共通ルール

- 1 回あたり 1 件以上 100 件まで。配列でない、空、101 件以上は 400。
- 全件成功か全件失敗のどちらか。1 件でも不正なら何も書かずに 400 を返す。
- 入力エラーの `fields` のキーは `items.<index>.<項目名>`（index は 0 始まり）。項目に結び付かないエラーは `items.<index>`。
- 一括更新で `number` が不正、課題が無い、削除済み、同じ番号が複数回、の場合は `items.<index>.number` に出る。
- `?dryRun=true` を付けると検証だけ行い、何も書かずに `{ "numbers": [] }` を 200 で返す（一括起票も 200）。検証で落ちるときは通常どおり 400。`dryRun` に指定できるのは未指定・`true`・`false` だけ。`1` や `TRUE` など他の値は、誤って書き込まないよう 400（`fields.dryRun`）にする。
- 本文のトップレベルのキーは `items` だけ。ほかのキーは 400（`fields` のキーはそのキー名）。
- 通知は、一括では課題ごとではなく、受け取る人ごとの「まとめ通知」1 件になる（リクエストごと）。担当者に設定された、メンションされた、それ以外の更新、のうち最も優先度の高い理由が文面になる。
- アーカイブ済みのプロジェクトへの書き込み（起票・更新・一括。dryRun も含む）は 409 `conflict`。

## 課題の項目

起票（POST）と更新（PATCH）で指定できる項目。リストにない項目は無視されず、400 になる（`fields` のキーは単発なら項目名、一括なら `items.<index>.<項目名>`、メッセージは `不明な項目です`）。一括更新の要素だけ、追加で `number` を指定する。

`resolution` は起票では指定できない（不明な項目として 400）。完了理由は、起票後の更新で付ける。

| 項目          | 型     | 起票                | 更新 | `null` の意味と補足                                                                              |
| ------------- | ------ | ------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `title`       | string | 必須                | 任意 | 空にできない。前後の空白は除く。200 文字以内                                                     |
| `description` | string | 任意（既定 空）     | 任意 | Markdown。50,000 文字以内。`null` は空文字にする                                                 |
| `typeId`      | string | 任意                | 任意 | 課題種別の ID。`null` で未設定                                                                   |
| `status`      | string | 任意（既定 `todo`） | 任意 | ステータスのキー。プロジェクト詳細の `statuses[].key`                                            |
| `resolution`  | string | 不可                | 任意 | 完了理由。`fixed` / `wont_fix` / `invalid` / `duplicate` / `cannot_reproduce`。`null` で空にする |
| `priority`    | string | 任意（既定 `none`） | 任意 | `none` / `low` / `medium` / `high` / `urgent`。`null` は不可                                     |
| `assigneeId`  | string | 任意                | 任意 | 担当者のユーザー ID。`members` に含まれる人だけ。`null` で未担当                                 |
| `startDate`   | string | 任意                | 任意 | `YYYY-MM-DD`。`null` で空にする                                                                  |
| `dueDate`     | string | 任意                | 任意 | `YYYY-MM-DD`。`null` で空にする                                                                  |
| `categoryId`  | string | 任意                | 任意 | カテゴリーの ID。`null` で未設定                                                                 |
| `milestoneId` | string | 任意                | 任意 | マイルストーンの ID。完了済みは指定できない。`null` で未設定                                     |

- `startDate` が `dueDate` より後なら 400（`開始日は期限日以前の日付にしてください`）。更新では、片方だけ送っても現在の値と合わせて検証する。
- 存在しない ID やキーは 400（例: `課題種別が見つかりません`、`ステータスが見つかりません`）。
- 一括更新の要素では、`number` 以外が変更する項目になる。

## 画面の URL

応答の `url`（課題）、`timelineUrl`（タイムライン）をそのままユーザーに見せてよい。
