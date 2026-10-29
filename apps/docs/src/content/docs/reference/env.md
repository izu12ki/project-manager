---
title: 環境変数
---

本番では `wrangler secret put` で、ローカルでは `apps/web/.dev.vars` で設定します。

| 名前 | 必須 | 説明 |
|---|---|---|
| `TURSO_DATABASE_URL` | ○ | `libsql://...`（ローカルは `http://127.0.0.1:8080`） |
| `TURSO_AUTH_TOKEN` | 本番は ○ | Turso の DB トークン |
| `BETTER_AUTH_SECRET` | ○ | 32 文字以上のランダム値（`openssl rand -base64 32`） |
| `BETTER_AUTH_URL` | ○ | 公開 URL（例 `https://pm.example.com`） |
| `MAIL_PROVIDER` | - | `cloudflare` / `smtp2go` / `resend` / `console`。未設定なら `console`（ログに出すだけ）。[メール送信の設定](/guides/mail/) |
| `MAIL_API_KEY` | `MAIL_PROVIDER` が `smtp2go` / `resend` なら ○ | `cloudflare` では不要 |
| `MAIL_FROM` | `MAIL_PROVIDER` が `console` 以外なら ○ | 例 `Project Manager <noreply@example.com>` |
| `SLACK_BOT_TOKEN` | - | Slack ボットのトークン（`xoxb-...`）。未設定なら Slack 通知は使えない。[Slack 連携](/guides/slack/) |
