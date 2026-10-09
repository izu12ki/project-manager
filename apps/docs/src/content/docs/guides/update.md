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
