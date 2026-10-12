# CLAUDE.md

## Git 運用

- コミットは確認不要。意味のある単位（1つの修正・機能・リファクタ）が完了し、型チェック等の検証が通った時点で都度コミットする。
  - 無関係な変更は混ぜない。自分が触っていない既存の未コミット変更はステージしない。
  - メッセージは既存の形式に合わせる（例: `fix(web): ...`, `feat(web): ...`）。
- push も確認不要。コミット後に適宜 push してよい（upstream 未設定なら `git push -u origin <branch>`）。
  - `--force` / `--force-with-lease` は禁止。必要になった場合は理由を説明して確認を取る。
  - `main` への直接 push はしない。作業はブランチで行う。

## デプロイ（Cloudflare Workers）

- 本番 Worker（`project-manager`）へのデプロイは確認不要。変更がまとまったら自己判断で適宜デプロイしてよい。
- デプロイ前に `pnpm check` / `pnpm lint` / `pnpm test:unit` / `pnpm test:e2e` をすべて通すこと。1つでも失敗したらデプロイしない。
- 手順: `apps/web` で `pnpm deploy`。完了後、デプロイしたバージョン ID と URL を報告する。
- アカウント ID は環境変数 `CLOUDFLARE_ACCOUNT_ID` で渡す。設定ファイルにコミットしない。
- 本番 DB（Turso）のマイグレーションを伴う場合は、実行前にその旨を一言伝える。
  - マイグレーション → デプロイの順で行う（新しいコードが新しい列を読むため）。
  - Claude Code の auto mode では本番マイグレーションが権限チェックで拒否される。自分で実行しようとせず、ユーザーが `!` で貼り付けて実行できるコマンドを最初から提示する。
  - 提示するコマンドは次の形にする。過去に以下の誤りで失敗している。
    - 作業ディレクトリが既に `apps/web` のことがあるので、`cd apps/web` を付けない（必要なら絶対パスで `cd` する）。
    - `turso db tokens create --expiration` は日数（`1d` など）か `never` しか受け付けない。`1h` は不可で、トークンが空のまま drizzle-kit が失敗する。

    ```
    ! cd /Users/izukihirano/orca/projects/project-manager/apps/web && TURSO_DATABASE_URL=libsql://project-manager-izu12ki.aws-ap-northeast-1.turso.io TURSO_AUTH_TOKEN="$(turso db tokens create project-manager --expiration 1d)" pnpm db:migrate
    ```

  - 適用後は `turso db shell project-manager "SELECT name FROM pragma_table_info('<table>');"` などで反映を確認してからデプロイする。
