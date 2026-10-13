---
title: アップデート
---

```bash
git pull
mise install
pnpm install
cd apps/web
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." pnpm db:migrate
pnpm deploy
```

マイグレーションは必ずデプロイの前に実行してください。

## 添付ファイル機能を含むバージョンへ更新する場合

デプロイの前に、R2 バケットを一度だけ作成してください。

```bash
pnpm exec wrangler r2 bucket create project-manager-attachments
```
