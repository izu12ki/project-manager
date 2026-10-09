# UI を shadcn-svelte に移行する設計書

- 日付: 2026-10-09
- ステータス: レビュー待ち
- 前提: `docs/superpowers/specs/2026-10-09-project-manager-design.md`（MVP）が実装済み

## 1. 目的

MVP の画面（Tailwind の自作クラス `.input` / `.btn` / `.btn-primary` / `.card`）を、shadcn-svelte と shadcn-svelte-extras の部品に置き換える。あわせてサイドバー型レイアウトとダークモードを導入する。機能・権限・データの流れは変えない。

## 2. 決定事項

| 項目 | 決定 |
|---|---|
| UI ライブラリ | shadcn-svelte 1.7 系（CLI `pnpm dlx shadcn-svelte@latest`） |
| 追加部品 | shadcn-svelte-extras（`jsrepo` で必要な部品だけ追加） |
| ベースカラー | Neutral |
| アイコン | `@lucide/svelte`（既存） |
| レイアウト | `Sidebar` 型（ログイン系の画面を除く） |
| ダークモード | 対応。`mode-watcher` で OS 設定に従い、Light Switch で手動切替 |
| フォーム | 既存の form actions + `use:enhance` + サーバー側 valibot のまま（superforms / formsnap は導入しない） |
| 選択入力 | `NativeSelect`（ネイティブ `<select>`。E2E の `selectOption` を維持） |

## 3. 部品の対応

| 現状 | 置き換え先 |
|---|---|
| ヘッダーナビ | `Sidebar`: 参加プロジェクト一覧、管理（admin のみ: ユーザー）、フッターにユーザーメニュー（アカウント、ログアウト）と Light Switch。モバイルは `Sidebar.Trigger` で開閉 |
| ボタン | `Button`（破壊的操作は `variant="destructive"`） |
| 入力 | `Field.FieldGroup` / `Field.Field` / `Field.FieldLabel` + `Input` / `Textarea` / `NativeSelect` |
| パスワード入力 | extras `Password`（表示切替付き） |
| 招待リンク | extras の `CopyButton`（または `Snippet`）を使った表示。再発行ボタンの横の注記は維持 |
| カード | `Card`（Header / Title / Description / Content / Footer） |
| 一覧表 | `Table` |
| ステータス / 優先度 / ロール / 無効 / 期限切れ | `Badge` |
| `confirm()` | `AlertDialog` |
| 保存完了などの通知 | `svelte-sonner` の `toast()` + `Sonner` |
| エラーメッセージ | `Alert`（`variant="destructive"`） |
| 空表示 | `Empty` |
| プロジェクト内タブ（一覧 / ボード / 設定） | URL リンクで切り替え。見た目は `Tabs` に合わせる |
| アーカイブ済みプロジェクト | `Collapsible` |

## 4. 画面

- **認証系**（`/login`, `/setup`, `/invite/[token]`, `/forgot-password`, `/reset-password`）: サイドバーなし。中央寄せの `Card` にフォーム。
- **ルートレイアウト**: ログイン中のみ `Sidebar.Provider` + `Sidebar` + `Sidebar.Inset`。`Sonner` を配置。
- **トップ `/`**: プロジェクトを `Card` グリッドで表示。アーカイブ済みは `Collapsible`。空なら `Empty`。admin には「新規プロジェクト」ボタン。
- **課題一覧**: 絞り込みは `NativeSelect` を横並び、結果は `Table`。ステータスと優先度は `Badge`。空なら `Empty`。
- **カンバン**: svelte-dnd-action のロジックは変更しない。列とカードの見た目を `Card` / `Badge` にする。失敗時のメッセージは `toast.error` でもよいが、`role="alert"` の表示は残す。
- **課題詳細**: 2 列（左: タイトル・本文・コメント、右: 属性フォーム）。課題削除とコメント削除は `AlertDialog`。
- **プロジェクト設定 / ユーザー管理**: セクションごとに `Card`。無効化・有効化・参加者を外す・招待取り消しは `AlertDialog` で確認（取り消しは任意）。
- **アカウント**: `Card` 2 枚（表示名、パスワード変更）。

## 5. 守る約束（変更しない）

- E2E が依存する文言と属性: ボタン「新規プロジェクト」「作成」「招待する」「ゲストを招待」「新規課題」「起票する」「保存」「コメントする」「ログイン」「ログアウト」「登録する」「セットアップを完了」、ラベル「キー」「プロジェクト名」「メールアドレス」「パスワード」「名前」「ロール」「参加プロジェクト」「ゲストのメールアドレス」「招待リンク」「タイトル」「担当者」「ステータス」「コメントを追加」、見出し「プロジェクト」、`data-testid="column-<status>"` / `card-<number>`、保存後の「保存しました」の表示。
- 招待リンク再発行ボタンのすぐ横に「コピーすると招待を再発行し、以前のリンクは無効になります」を常時表示。
- 権限による表示・操作の出し分け（`perms` / `can()`）と、JavaScript なしでもフォームが送信できること（progressive enhancement）。`AlertDialog` で確認する操作も、JavaScript なしでは確認なしで送信されてよい。
- Markdown の `{@html}` は `renderMarkdown` の出力のみ。

## 6. 確認方法

- 既存の単体テスト（114 件）と E2E がそのまま通ること。E2E のセレクタは原則変えない。変える場合は理由を記録する。
- `pnpm check` / `pnpm lint` が通ること（shadcn が生成した部品も対象）。
- ライト / ダーク両方で主要画面（ログイン、トップ、課題一覧、ボード、課題詳細、設定、ユーザー管理）のスクリーンショットを撮り、崩れがないことを目視確認する。
- 本番へのデプロイは人間のパートナーの確認後に行う。

## 7. スコープ外

- 新機能、権限やデータモデルの変更
- superforms / formsnap の導入
- 多言語対応
