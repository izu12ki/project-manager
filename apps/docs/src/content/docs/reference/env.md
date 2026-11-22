---
title: 環境変数
description: Worker に設定するシークレットと環境変数の一覧
---

本番では `wrangler secret put` で、ローカルでは `apps/web/.dev.vars` で設定します。DB（D1）と添付ファイルの保存先（R2）は環境変数ではなく、`apps/web/wrangler.jsonc` のバインディングで結び付けます。

| 名前 | 必須 | 説明 |
|---|---|---|
| `BETTER_AUTH_SECRET` | ○ | 32 文字以上のランダム値（`openssl rand -base64 32`） |
| `BETTER_AUTH_URL` | ○ | 公開 URL（例 `https://pm.example.com`） |
| `MAIL_PROVIDER` | - | `cloudflare` / `smtp2go` / `resend` / `console`。未設定なら `console`（ログに出すだけ）。[メール送信の設定](/guides/mail/) |
| `MAIL_API_KEY` | `MAIL_PROVIDER` が `smtp2go` / `resend` なら ○ | `cloudflare` では不要 |
| `MAIL_FROM` | `MAIL_PROVIDER` が `console` 以外なら ○ | 例 `Project Manager <noreply@example.com>` |
| `SLACK_BOT_TOKEN` | - | Slack ボットのトークン（`xoxb-...`）。未設定なら Slack 通知は使えない。[Slack 連携](/guides/slack/) |
