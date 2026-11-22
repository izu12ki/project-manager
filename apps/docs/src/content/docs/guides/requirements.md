---
title: 必要なもの
description: デプロイの前に用意するアカウントと、手元の PC に入れるツール
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers）とデータベース（D1） | **Workers Paid プランが必要**（下記「Workers のプラン」参照） |
| Cloudflare R2 | **必須** | 添付ファイルの保存 | 10GB まで無料。初回はダッシュボードの「R2」で利用を開始する |
| Cloudflare Email Sending（推奨）、[SMTP2GO](https://www.smtp2go.com)、[Resend](https://resend.com) のどれか | 任意 | 招待メール・パスワードリセットメールの送信 | Email Sending は Workers Paid プランに月 3,000 通まで含まれる（送信元ドメインの DNS を Cloudflare で管理している場合）。SMTP2GO・Resend は無料枠あり（[メール送信の設定](/guides/mail/)） |

:::note
Cloudflare アカウントの作成が必要です。このツールは Cloudflare Workers 上でのみ動作します。
:::

## Workers のプラン

:::caution[Workers Paid プラン（月額 5 ドル〜）が必要です]
無料プランのままだと、ログインやアカウント登録が「Worker exceeded CPU time limit」エラーで失敗することがあります。
:::

パスワードのハッシュ化（scrypt）は CPU を多く使います。無料プランの CPU 時間の上限は 1 リクエストあたり 10ms ですが、実測（2026-10、ログイン・ログアウトを繰り返した計測）では P50 が 29.75ms、P99 が 373ms で、上限を大きく超えました。

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js と pnpm をそろえてインストールするため）
- Git
