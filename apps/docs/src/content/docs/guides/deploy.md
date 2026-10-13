---
title: デプロイ手順
---

## 1. ソースを取得してツールを入れる

```bash
git clone <このリポジトリの URL> project-manager
cd project-manager
mise install
pnpm install
```

## 2. Turso にデータベースを作る

```bash
turso auth signup        # 初回のみ。既にアカウントがあれば turso auth login
turso db create project-manager
turso db show project-manager --url      # libsql://... を控える
turso db tokens create project-manager   # トークンを控える
```

## 3. データベースにテーブルを作る

```bash
cd apps/web
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." pnpm db:migrate
```

## 4. Cloudflare にログインしてシークレットを登録する

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put TURSO_DATABASE_URL
pnpm exec wrangler secret put TURSO_AUTH_TOKEN
pnpm exec wrangler secret put BETTER_AUTH_SECRET   # `openssl rand -base64 32` の出力
pnpm exec wrangler secret put BETTER_AUTH_URL      # 公開 URL。例: https://project-manager.<サブドメイン>.workers.dev
```

添付ファイルを保存する R2 バケットを作ります（名前は `apps/web/wrangler.jsonc` の `bucket_name` と同じにします）。

```bash
pnpm exec wrangler r2 bucket create project-manager-attachments
```

メールを送る場合は `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` も登録します（[メール送信の設定](/guides/mail/)）。登録しなければ招待リンクは画面に表示されるので、手で相手に渡せます。

初回はまだ Worker が無いので、`secret put` が Worker の作成を確認してきたら「はい」を選びます。`BETTER_AUTH_URL` が分からない場合は、先に手順 5 でデプロイして URL を確認し、登録後にもう一度デプロイします。

## 5. デプロイする

```bash
pnpm deploy
```

表示された URL を開くと初期セットアップ画面（`/setup`）になります。最初の管理者アカウントを作成してください。

独自ドメインを使う場合は Cloudflare ダッシュボードの Workers の「Settings → Domains & Routes」で設定し、`BETTER_AUTH_URL` をその URL に変えて再デプロイします。
