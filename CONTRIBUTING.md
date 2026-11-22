# 開発への参加

不具合の報告、機能の提案、Pull Request を歓迎します。Issue と Pull Request は日本語か英語で書いてください。

## Issue

- 不具合の報告と機能の提案は、[Issue のテンプレート](https://github.com/izu12ki/project-manager/issues/new/choose)から作ってください。
- 同じ内容の Issue がないか、先に検索してください。
- **脆弱性は Issue にしないでください。** [SECURITY.md](SECURITY.md) の手順で非公開で報告してください。

## Pull Request の前に

小さな不具合の修正や誤字の修正は、そのまま Pull Request を送ってください。

機能の追加、画面や API の挙動の変更、DB スキーマの変更、依存パッケージの追加は、先に Issue で相談してください。方針が合わずに作業が無駄になるのを避けるためです。

## 開発環境

[mise](https://mise.jdx.dev/) で Node.js と pnpm をそろえます。DB はローカルの D1（wrangler が `.wrangler/state` に作る SQLite）なので、別のサーバーを起動する必要はありません。

```bash
mise install
pnpm install
cd apps/web
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を書き換える
pnpm db:migrate:local            # ローカルの D1 にテーブルを作る
pnpm dev                         # http://localhost:5173
```

詳しくはドキュメントの[ローカル開発](https://project-manager-docs.hirano-i.workers.dev/contributing/local-dev/)を参照してください。ドキュメントサイトは `pnpm docs:dev` で起動します。

## 変更の進め方

### コードの置き場所

- 業務ロジックと権限チェックは `apps/web/src/lib/server/services/` に書き、ここに単体テストを足します。
- 画面（`apps/web/src/routes/`）は services を呼ぶだけにします。
- 画面をまたぐ主要な操作は、E2E テスト（`apps/web/e2e/`）で確かめます。

### DB スキーマを変えるとき

`apps/web/src/lib/server/db/schema.ts` を変えたら、マイグレーションを生成して一緒にコミットします。

```bash
cd apps/web
pnpm db:generate --name <変更内容>
pnpm db:migrate:local
```

`pnpm db:migrate:local`（本番は `pnpm db:migrate:remote`）は、`drizzle/` のマイグレーションを `wrangler d1 migrations apply` が読める形に変換して（`pnpm db:sync`、出力先は gitignore 済みの `.d1-migrations/`）から適用します。

セルフホストしている利用者は、更新のたびにマイグレーションを自分で実行します。既存のデータが壊れないか、新しい列の既定値は適切かを確かめてください。

### D1 の制約

DB は Cloudflare D1 です。SQL は SQLite と同じですが、次の制約があります。単体テストの DB（`createTestDb`）は 1〜4 を再現していて、違反するとテストが失敗します。

1. `db.transaction()` は使えません。まとめて成功・失敗させたい書き込みは `db.batch()` にします（batch は 1 つのトランザクションとして実行されます）。
2. 1 つのクエリのバインド変数は 100 個までです。`IN` には `drizzle-orm` の `inArray` ではなく `apps/web/src/lib/server/db/limits.ts` の `inList` を使い（ESLint で強制しています）、複数行の insert は `insertChunks` で分けます。
3. `db.batch()` に入れた select の結果は、列名をキーにした行で返ります。そのため、同じ名前の列（join した表の `id` や `name` など）があると値がずれます。batch の中で join するときは、列に別名（`` sql`${列}`.as('別名') ``）を付けます。
4. LIKE のパターンは 50 バイトまでです（日本語なら 16 文字ほど）。利用者が入力した文字列での部分一致には、LIKE ではなく `instr` を使います。
5. Workers の無料プランでは、1 回のリクエストで 50 クエリまでです（`db.batch()` は 1 回と数えます）。
6. 外部キー制約を切れません。テーブルを作り直すマイグレーション（drizzle が `PRAGMA foreign_keys=OFF` を出すもの）では、`DROP TABLE` の時点で `ON DELETE CASCADE` の子の行が消えます。ほかのテーブルから参照されているテーブルは作り直さないでください。`pnpm db:sync` は `PRAGMA foreign_keys=OFF` を `PRAGMA defer_foreign_keys = on` に置き換えますが、これで防げるのは制約違反のエラーだけです。

### ドキュメント

利用者から見える変更は、同じ Pull Request でドキュメントも直します。

- 手順・設定・画面の説明: `apps/docs/src/content/docs/`
- REST API: `skills/project-manager/reference.md`（必要なら `SKILL.md` も）

### Changeset

利用者に影響する変更（機能追加・不具合修正・設定や手順の変更）には changeset を付けます。

```bash
pnpm changeset
```

対象パッケージは `web` を選びます。要約はリリースノートにそのまま載るので、利用者向けに書いてください。DB マイグレーションや新しい Cloudflare リソース、環境変数の追加が必要な場合は、要約の中で明記します。種類の選び方と不要な場合は [.changeset/README.md](.changeset/README.md) を参照してください。

### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形式で書きます。

```text
feat(web): show the project name in bold in the sidebar
fix(web): keep category order stable
docs: describe multiple categories in the API reference
```

| 種類           | 使うとき                   |
| -------------- | -------------------------- |
| `feat`         | 機能の追加                 |
| `fix`          | 不具合の修正               |
| `docs`         | ドキュメントだけの変更     |
| `test`         | テストだけの変更           |
| `refactor`     | 挙動を変えないコードの整理 |
| `perf`         | 性能の改善                 |
| `style`        | 書式だけの変更             |
| `ci` / `chore` | CI・ビルド・設定などの変更 |

スコープは変更した場所です（`web`、`e2e` など）。1 つのコミットには 1 つの変更だけを入れてください。

## 確認

Pull Request を送る前に、次がすべて通ることを確かめてください。CI でも同じものを実行します。

```bash
pnpm lint
pnpm check
pnpm test:unit
pnpm test:e2e     # 初回は pnpm --filter web exec playwright install chromium が必要
pnpm docs:build   # ドキュメントを変えた場合
```

書式の崩れは `pnpm --filter web format` で直せます。

## Pull Request

- `main` に向けて送ってください。1 つの Pull Request には 1 つの話題だけを入れます。
- テンプレートに沿って、何をなぜ変えたか、どう確かめたかを書いてください。画面の変更にはスクリーンショットを付けてください。
- 関連する Issue があれば `Closes #123` のように書いてください。

## ライセンス

送っていただいた変更は、このリポジトリと同じ [MIT ライセンス](LICENSE)で公開されます。
