---
title: ローカル開発
---

```bash
mise install
pnpm install
cd apps/web
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を書き換える
pnpm db:local                    # 別ターミナルで起動したまま
pnpm db:migrate
pnpm dev                         # http://localhost:5173
```

`mise install` は Node.js・pnpm・Turso CLI と、`pnpm db:local` が使うローカル DB サーバー（sqld）を入れます。最初に一度実行してください。

## テスト

```bash
pnpm test:unit --run   # services の単体テスト（インメモリ DB）
pnpm test:e2e          # Playwright（turso dev と wrangler dev を自動で起動）
pnpm lint && pnpm check
```

## スキーマを変えたとき

```bash
pnpm db:generate --name <変更内容>
pnpm db:migrate
```

## 構成

- `apps/web/src/lib/server/services/` — 業務ロジックと権限チェック（ここをテストする）
- `apps/web/src/routes/` — 画面。services を呼ぶだけにする
- `apps/web/src/hooks.server.ts` — 認証と、Cloudflare の env の読み込み（`cloudflare:workers` を import するのはここだけ）
