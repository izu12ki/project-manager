---
title: 必要なもの
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers） | **Workers Paid プランが必要**（下記「Workers のプラン」参照） |
| [Turso](https://turso.tech) | **必須** | データベース（libSQL） | 無料プランあり |
| [SMTP2GO](https://www.smtp2go.com) または [Resend](https://resend.com) | 任意 | 招待メール・パスワードリセットメールの送信 | 無料枠あり（[メール送信の設定](/guides/mail/)） |

**Cloudflare アカウントの作成が必要です。** このツールは Cloudflare Workers 上でのみ動作します。

## Workers のプラン

**Workers Paid プラン（月額 5 ドル〜）が必要です。**

パスワードのハッシュ化（scrypt）は CPU を多く使います。無料プランの CPU 時間の上限は 1 リクエストあたり 10ms ですが、実測（2026-10、ログイン・ログアウトを繰り返した計測）では P50 が 29.75ms、P99 が 373ms で、上限を大きく超えました。無料プランのままだと、ログインやアカウント登録が「Worker exceeded CPU time limit」エラーで失敗することがあります。

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js・pnpm・Turso CLI・sqld（ローカル DB サーバー）をそろえてインストールするため）
- Git
