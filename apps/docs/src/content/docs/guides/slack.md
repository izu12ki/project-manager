---
title: Slack 連携
---

自分に関わる出来事（担当になった・関わる課題へのコメント・ステータスの変更・メンション）を、Slack の DM で受け取れます。届く内容はアプリ内通知と同じです。

## 管理者: Slack アプリを用意する（一度だけ）

1. https://api.slack.com/apps で「Create New App」→「Blank app」を選び、アプリ名（例: `projectManagerNotification`）とワークスペースを指定します。スコープとイベントの画面は何も追加せずに進めて作成します。
2. 「OAuth & Permissions」の Bot Token Scopes に `chat:write`、`users:read`、`users:read.email` を追加します。
3. 同じ画面の「Install to Workspace」でインストールし、`xoxb-` で始まる Bot User OAuth Token をコピーします。
4. 「App Home」で Messages Tab を有効にします（利用者がボットとの DM を見られるようにするため）。
5. トークンを Worker のシークレットに設定します。

   ```sh
   pnpm exec wrangler secret put SLACK_BOT_TOKEN                # 本番
   pnpm exec wrangler secret put SLACK_BOT_TOKEN --env preview  # プレビュー
   ```

ワークスペースの設定によっては、アプリのインストールに Slack 管理者の承認が必要です。

## 各ユーザー: Slack 通知をオンにする

1. サイドバー下部の自分の名前をクリックし、メニューから「アカウント」を開きます。
2. 「Slack 通知」の「オンにする」を押します。Slack にボットから確認のメッセージが届けば完了です。

:::caution[メールアドレスの一致が前提です]
このアプリのログイン用メールアドレスと、Slack のプロフィールのメールアドレスが同じ場合にだけ届きます。「アカウントが見つかりませんでした」と表示された場合は、Slack のプロフィールのメールアドレスを確認してください。Slack 側のメールアドレスを変えたときは、一度オフにしてからオンにし直してください。
:::

## 届く内容

- 「花子さんが コメント しました。」のような 1 行と、課題（コメントの場合はそのコメント）へのリンク
- 2 行目に補足（コメントの先頭 200 文字、変更前後のステータス、優先度）
- 自分の操作は届きません。1 回の操作で届くのは 1 人 1 通です。

送信に失敗しても再送はしません（Worker のログに記録されます）。
