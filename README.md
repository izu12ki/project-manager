# Project Manager

受託開発会社と顧客（ゲスト）が課題を共有するための、セルフホスト型プロジェクト管理ツールです。Cloudflare Workers と Turso で動きます。

- 課題管理（番号・ステータス・優先度・担当者・期限）とカンバン
- Markdown のコメント
- 顧客をゲストとして招待し、参加プロジェクトだけを見せる

**利用には Cloudflare アカウントと Turso アカウントが必要です。** 手順はドキュメント（`apps/docs`）を参照してください。

## 開発

```bash
mise install && pnpm install   # mise install はローカル DB サーバ (sqld) も導入します
pnpm docs:dev   # ドキュメント
pnpm dev        # アプリ（事前に apps/web で .dev.vars と pnpm db:local が必要）
```

## ライセンス

MIT
