## 概要

<!-- 何を、なぜ変えるか。関連する Issue があれば「Closes #123」と書いてください -->

## 確認

<!-- どう確かめたか。画面の変更にはスクリーンショットを付けてください -->

## チェックリスト

- [ ] `pnpm lint` / `pnpm check` / `pnpm test:unit` / `pnpm test:e2e` が通る
- [ ] 利用者に影響する変更に changeset を付けた（不要な変更なら外してよい）
- [ ] DB スキーマを変えた場合、マイグレーションを含め、changeset にマイグレーションが必要なことを書いた
- [ ] 画面・API・設定を変えた場合、ドキュメント（`apps/docs`、`skills/project-manager/reference.md`）を直した
