---
'web': minor
---

データベースを Turso から Cloudflare D1 に変えました。Turso のアカウントは要らなくなり、Cloudflare のアカウントだけで動きます。

- 新しく導入するときは、ドキュメントの「デプロイ手順」に沿って `wrangler d1 create` で D1 を作り、`pnpm db:migrate:remote` でテーブルを作ります。
- マイグレーションのコマンドは `pnpm db:migrate` から `pnpm db:migrate:remote` に変わりました。シークレットの `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` は使わなくなりました。
- Turso のデータを D1 へ移す手順とスクリプトは用意していません。
