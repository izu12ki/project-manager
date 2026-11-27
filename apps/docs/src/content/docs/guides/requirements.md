---
title: 必要なもの
description: デプロイの前に用意するアカウントと、手元の PC に入れるツール
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers）とデータベース（D1） | 無料プランで動く（[Workers のプランと上限](/guides/workers-plan/)） |
| Cloudflare R2 | **必須** | 添付ファイルの保存 | 10GB まで無料。初回はダッシュボードの「R2」で利用を開始する |
| [SMTP2GO](https://www.smtp2go.com)、[Resend](https://resend.com)、Cloudflare Email Sending のどれか | 任意 | 招待・パスワードリセット・通知のメールの送信 | SMTP2GO・Resend は無料枠あり。Email Sending は送信元ドメインの DNS を Cloudflare で管理している場合に使え、Workers の無料プランでは Cloudflare アカウントで確認したアドレスにだけ送れる（誰にでも送るには Workers Paid プラン。月 3,000 通まで含まれる）（[メール送信の設定](/guides/mail/)） |

:::note
Cloudflare アカウントの作成が必要です。このツールは Cloudflare Workers 上でのみ動作します。
:::

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js と pnpm をそろえてインストールするため）
- Git
