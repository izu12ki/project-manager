# Project Manager ドキュメントサイト

Astro Starlight で作った利用者・開発者向けドキュメント（日本語）。Cloudflare Workers の静的アセットとして公開します。

- 開発サーバー: リポジトリルートで `pnpm docs:dev`
- ビルド: リポジトリルートで `pnpm docs:build`（出力は `apps/docs/dist`）
- デプロイ: `pnpm --filter docs deploy`（事前に `pnpm exec wrangler login` が必要）
- ページは `src/content/docs/` 配下の Markdown / MDX、サイドバーは `astro.config.mjs` で管理
