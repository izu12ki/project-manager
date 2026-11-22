---
title: アップデート
description: 新しいバージョンへ更新する手順
---

新しいバージョンは [GitHub Releases](https://github.com/izu12ki/project-manager/releases) で公開しています。更新する前にリリースノートを読み、DB マイグレーションや新しいリソースの作成など、必要な作業がないか確認してください。

最新のリリースタグを取得し、マイグレーションを実行してからデプロイします。

```bash
git fetch --tags
git checkout "$(git tag --list 'web@*' --sort=-version:refname | head -n 1)"
mise install
pnpm install
cd apps/web
pnpm db:migrate:remote
pnpm deploy
```

:::caution
マイグレーションは必ずデプロイの前に実行してください。新しいコードは新しい列を読むため、順番が逆になるとエラーになります。
:::

## 添付ファイル機能を含むバージョンへ更新する場合

デプロイの前に、R2 バケットを一度だけ作成してください。

```bash
pnpm exec wrangler r2 bucket create project-manager-attachments
```

## 祝日の更新

タイムラインの祝日はアプリ内の規則から計算しています。祝日法の改正で祝日が追加・変更された場合は、その変更を含むバージョンへ更新してください。

:::note[開発者向け]
内閣府は毎年 2 月ごろ翌年の祝日を公開します。`apps/web` で `pnpm holidays:fetch` を実行して `src/lib/testdata/syukujitsu.csv` を更新し、`pnpm test:unit` で計算結果と一致することを確認してください。一致しない場合は `src/lib/holidays.ts` の `RULES` を直します。
:::
