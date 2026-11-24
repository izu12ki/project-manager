---
title: 必要なもの
description: デプロイの前に用意するアカウントと、手元の PC に入れるツール
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers）とデータベース（D1） | 無料プランで動く（下記「Workers のプラン」参照） |
| Cloudflare R2 | **必須** | 添付ファイルの保存 | 10GB まで無料。初回はダッシュボードの「R2」で利用を開始する |
| [SMTP2GO](https://www.smtp2go.com)、[Resend](https://resend.com)、Cloudflare Email Sending のどれか | 任意 | 招待メール・パスワードリセットメールの送信 | SMTP2GO・Resend は無料枠あり。Email Sending は Workers Paid プランのみ（月 3,000 通まで含まれる。送信元ドメインの DNS を Cloudflare で管理している場合）（[メール送信の設定](/guides/mail/)） |

:::note
Cloudflare アカウントの作成が必要です。このツールは Cloudflare Workers 上でのみ動作します。
:::

## Workers のプラン

小規模なチームなら、Workers の無料プランで動きます。無料プランの主な上限は次のとおりです（2026-11 時点。最新の値は Cloudflare の [Workers](https://developers.cloudflare.com/workers/platform/limits/)・[D1](https://developers.cloudflare.com/d1/platform/limits/) の上限のページで確認してください）。

| 上限 | 無料プラン |
|---|---|
| リクエスト数 | 1 日 10 万回 |
| 1 リクエストの CPU 時間 | 10ms |
| D1 の容量 | 1 つの DB で 500MB |
| D1 の読み書き | 1 日に読み取り 500 万行、書き込み 10 万行 |

CPU 時間は、パスワードの重い計算をブラウザで行い、1 つの画面の読み取りを DB への 1〜2 回の往復にまとめて、課題一覧・カンバン・タイムラインなどの画面がおおむね 10ms に収まるようにしています。ただし次のものは 10ms を超えます。

- 課題の詳細画面を、ブックマークや Slack 通知のリンク、再読み込みなどから開いた時（アプリ内の一覧やカンバンから遷移した時は超えません）: 10〜20ms ほど
- 課題の保存、Backlog からの取り込み、起動したばかりの Worker への最初のリクエスト: 数十 ms

Cloudflare は上限を超えるリクエストをある程度許しますが、超え続けると処理を打ち切ることがあります（ 1102 エラー）。無料プランのアカウントで、E2E テストの全操作（ログイン、課題の起票・編集、コメント、招待、Backlog からの取り込み、パスワードの再設定など）と、課題の詳細画面を続けて開く操作を流した確認（2026-11）では、 1102 エラー は出ませんでした。

次のどれかに当てはまるなら、Workers Paid プラン（月額 5 ドル〜）にしてください。

- Cloudflare Email Sending でメールを送りたい（[メール送信の設定](/guides/mail/)）
- 利用者が多く、1 日のリクエスト数や D1 の読み書きが上限に近い
- 「Worker exceeded resource limits」（1102 エラー）が出る

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js と pnpm をそろえてインストールするため）
- Git
