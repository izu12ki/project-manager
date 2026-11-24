# Project Manager ドキュメントサイト

Astro Starlight で作った利用者・開発者向けドキュメント（日本語）。Cloudflare Workers の静的アセットとして公開します。

- 開発サーバー: リポジトリルートで `pnpm docs:dev`
- ビルド: リポジトリルートで `pnpm docs:build`（出力は `apps/docs/dist`）
- デプロイ: リリース（`web@x.y.z` のタグ作成）のたびに Release ワークフロー（`.github/workflows/release.yml`）が行う。リリースを待たずに出すときは Actions から Release ワークフローを手動実行する（main のドキュメントだけをデプロイする）
  - 手元から出すとき: `pnpm --filter docs run deploy`（事前に `pnpm exec wrangler login` が必要）
- ページは `src/content/docs/` 配下の Markdown / MDX、サイドバーは `astro.config.mjs` で管理
