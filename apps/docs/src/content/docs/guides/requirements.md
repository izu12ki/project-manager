---
title: 必要なもの
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers） | 無料プランあり。下記「Workers のプラン」参照 |
| [Turso](https://turso.tech) | **必須** | データベース（libSQL） | 無料プランあり |
| [SMTP2GO](https://www.smtp2go.com) または [Resend](https://resend.com) | 任意 | 招待メール・パスワードリセットメールの送信 | 無料枠あり（[メール送信の設定](/guides/mail/)） |

**Cloudflare アカウントの作成が必要です。** このツールは Cloudflare Workers 上でのみ動作します。

## Workers のプラン

パスワードのハッシュ化（scrypt）は CPU を多く使います。Workers 無料プランの CPU 時間の上限（1 リクエストあたり 10ms）に収まるかどうかは検証中です。ログインやアカウント登録で「Worker exceeded CPU time limit」エラーが出る場合は、Workers Paid プラン（月額 5 ドル〜）に切り替えてください。

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js・pnpm・Turso CLI・sqld（ローカル DB サーバー）をそろえてインストールするため）
- Git
