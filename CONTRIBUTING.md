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

[mise](https://mise.jdx.dev/) で Node.js・pnpm・Turso CLI をそろえます。

```bash
mise install
pnpm install
cd apps/web
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を書き換える
pnpm db:local                    # 別ターミナルで起動したまま
pnpm db:migrate
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
pnpm db:migrate
```

セルフホストしている利用者は、更新のたびにマイグレーションを自分で実行します。既存のデータが壊れないか、新しい列の既定値は適切かを確かめてください。

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
