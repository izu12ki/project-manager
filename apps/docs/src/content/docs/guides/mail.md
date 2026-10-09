---
title: メール送信の設定
---

招待メールとパスワードリセットのメールを送るには、SMTP2GO か Resend のどちらかを使います。どちらも HTTP API で送信します。

| | 無料枠（2026-10 時点） |
|---|---|
| SMTP2GO | 月 1,000 通・1 日 200 通 |
| Resend | 月 3,000 通・1 日 100 通（宛先 1 件ごとに 1 通と数える） |

最新の条件は各サービスの料金ページで確認してください。

## 共通の手順

1. サービスに登録し、送信元に使うドメインを認証する（DNS に SPF / DKIM レコードを追加）
2. API キーを発行する
3. シークレットを登録して再デプロイする

```bash
cd apps/web
pnpm exec wrangler secret put MAIL_PROVIDER   # smtp2go または resend
pnpm exec wrangler secret put MAIL_API_KEY
pnpm exec wrangler secret put MAIL_FROM       # 例: Project Manager <noreply@example.com>
pnpm deploy
```

## メールが届かないとき

- 送信に失敗してもアプリの操作自体は成功します。失敗は Workers のログ（ダッシュボードの Observability、または `pnpm exec wrangler tail`）に `invitation mail failed` として出ます。
- 招待は管理画面の「未使用の招待」から「リンクをコピー」でいつでも渡せます。**コピーすると招待を再発行し、以前のリンクは無効になります。**
