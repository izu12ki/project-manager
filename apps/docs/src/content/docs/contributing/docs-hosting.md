---
title: このドキュメントの公開
description: このドキュメントサイトを Cloudflare Workers で公開する
---

このドキュメントサイトも Cloudflare Workers（静的アセット）で公開できます。Cloudflare アカウントが必要です。

```bash
cd apps/docs
pnpm exec wrangler login
pnpm deploy
```
