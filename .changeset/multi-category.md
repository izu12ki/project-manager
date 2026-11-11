---
"web": minor
---

課題にカテゴリーを複数付けられるようにしました。一覧とカンバンには付いているカテゴリーをすべて表示します。

- 更新時に DB マイグレーション（`pnpm db:migrate`）が必要です。既存の課題のカテゴリーは自動で移ります。
- REST API の課題の項目 `categoryId` を `categoryIds`（ID の配列）に変えました。`categoryId` を送ると 400 になります。一覧の絞り込みクエリ `categoryId` は変わりません。
