---
'web': patch
---

SvelteKit の Cloudflare アダプターを v9 に上げました。

- `apps/web/wrangler.jsonc` から `main` と `assets.directory` を消しました。どちらもビルド時にアダプターが設定します。`wrangler.jsonc` を手元で書き換えている場合は、この 2 つを消してください。`main` が残っているとビルドが止まります。
- `pnpm deploy` の手順は変わりません。ビルドしたものを手元で動かすときは `pnpm preview`（`wrangler dev --port 4173`）を使います。
