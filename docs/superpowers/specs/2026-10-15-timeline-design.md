# タイムライン（ガントチャート）設計書

日付: 2026-10-15
前提: `2026-10-09-project-manager-design.md`（以下「本体設計書」）の権限・データモデル・エラー処理に従う。

## 1. 目的とスコープ

社内のスケジュール調整のため、課題を開始日〜期限のバーとして時間軸に並べ、ドラッグで日付を組み替えられるようにする。

マイルストーン（作成・編集・完了、課題への割当、一覧・ボードでの絞り込み）と課題の開始日・期限は実装済み。本書はその上に表示と編集の画面を足すだけで、**DB マイグレーションは発生しない**。

### 含む

- プロジェクト内タブ「タイムライン」（`/projects/[key]/timeline`）
- 担当者別 / マイルストーン別のグループ切替、マイルストーン絞り込み
- マイルストーンのリリース日の縦線と、グループ見出しの進捗（完了数 / 全数）
- バーのドラッグによる移動（開始日・期限を同じ日数ずらす）と、両端のドラッグによる伸縮
- 日付未設定の課題を並べる「未スケジュール」欄と、そこからタイムラインへの配置

### 含まない

- 課題間の依存関係（矢印）、クリティカルパス
- 時間単位の予定、祝日カレンダー（週末の網掛けのみ）
- 画像・PDF・CSV への書き出し
- キーボードによる日付変更（課題詳細の日付入力で代替する）
- 日付変更の通知（現状の `updateIssue` も日付変更では通知しない。これに合わせる）

## 2. 画面

### パスとクエリ

`/projects/[key]/timeline`。プロジェクトの参加者全員が閲覧できる（本体設計書 §3 の「閲覧」）。

| クエリ | 値 | 既定 |
|---|---|---|
| `group` | `assignee` / `milestone` | `assignee` |
| `milestone` | マイルストーン ID / `none` / 空 | 空（絞り込みなし。ボードと同じ意味） |
| `scale` | `day` / `week` | `day` |
| `from` | `YYYY-MM-DD` | 今日を含む週の月曜の 1 週間前 |

クエリはボードと同様に URL に保持し、切替は `goto(..., { replaceState: true, keepFocus: true, noScroll: true })` で行う。

### タブ

`/projects/[key]/+layout.svelte` の `tabs` に「タイムライン」（アイコン `@lucide/svelte` の `ChartGantt`）を「ボード」の後に追加する。

### レイアウト

```
[グループ: 担当者 | マイルストーン] [マイルストーン: ▼] [表示: 日 | 週]   [◀ 前] [今日] [次 ▶]
┌──────────────┬──────────────────────────────────────────────┐
│ 行ラベル       │ 10/6 10/7 ...（scale=day: 日付 / week: 週の月曜） │
├──────────────┼──────────────────────────────────────────────┤
│ ▸ 山田 (3/5)   │                                              │ ← グループ見出し（完了/全数）
│   ACME-12 ログ…│      ███████                                  │
│   ACME-15 一覧…│            ████████████                       │
│ ▸ 未割当       │                                              │
│ ...           │            ┊今日        ┃v1.0 リリース          │
└──────────────┴──────────────────────────────────────────────┘
未スケジュール（N 件）: [ACME-20 ...] [ACME-21 ...]   ← ドラッグしてタイムラインへ
```

- 左の行ラベル列（課題キーとタイトル、横幅固定）は横スクロール時も固定する（`position: sticky`）。右の時間軸は横スクロールする。
- 行の並び: グループ内は 開始日（なければ期限）昇順 → 番号昇順。
- グループの並び:
  - 担当者別: 表示名の昇順、最後に「未割当」。
  - マイルストーン別: リリース日の昇順（リリース日なしは後ろ、同順は名前順）、最後に「マイルストーンなし」。完了済みマイルストーンも課題があれば表示する。
- 課題のないグループは出さない。
- 「今日」は利用者のブラウザのローカル日付で決め、縦の点線で示す。週末（土日）の列は網掛けにする。
- マイルストーン別のとき、リリース日のあるマイルストーンは、そのグループの範囲にリリース日の縦線（太線）と名前を出す。

### 表示範囲とスケール

| scale | 1 日の幅 | 表示期間 | 見出し | 前 / 次の移動量 |
|---|---|---|---|---|
| `day` | 32px | 6 週間（42 日） | 月の境目に「M月」、各日に日付と曜日 | 3 週間 |
| `week` | 8px | 26 週間（182 日） | 月の境目に「YYYY年M月」、各週の月曜に日付 | 13 週間 |

`from` はスケールに関係なく月曜に丸める。「今日」ボタンは `from` を既定値に戻す。

範囲外にはみ出すバーは表示範囲の端で切り、切れた側の端を矢印形にする（はみ出した側の伸縮ハンドルは出さない）。範囲内にバーがない課題もグループの行には出し、行ラベルの横に範囲外であることを示す「◀」「▶」を出す。押すと、その課題の開始日が範囲の左から 1 週目に来るよう `from` を動かす。

### バー

- 色はステータス色（`$lib/labels` の既存の色）。`done` は不透明度を下げる。
- バー上に `KEY-番号` を表示し、ホバーでタイトル・期間・担当者をツールチップ（`title` 属性）で出す。
- 開始日だけ・期限だけの課題は、その日 1 日分のバーとして描き、欠けている側の端を点線にする。
- クリック（ドラッグを伴わないポインタ操作）で課題詳細へ遷移する。バー自体は `<a href>` にし、キーボードでも開けるようにする。

### ドラッグ操作

ポインタイベント（`pointerdown` / `pointermove` / `pointerup`、`setPointerCapture`）で自前実装する。マウスとタッチの両方で動く。ボードの `svelte-dnd-action` は使わない（リスト並べ替え用で、時間軸上の連続移動に向かないため）。

| 操作 | 結果 |
|---|---|
| バー中央をドラッグ | 開始日・期限を同じ日数だけずらす。片方しかなければその日付だけずらす |
| 左端をドラッグ | 開始日を変える。期限を超えられない（期限と同日まで） |
| 右端をドラッグ | 期限を変える。開始日より前にできない（開始日と同日まで） |
| 片方の日付しかないバーの欠けた側の端をドラッグ | 欠けている日付を設定する（例: 期限だけのバーの左端 → 開始日を設定） |
| 未スケジュール欄の課題をタイムライン上へドロップ | 開始日・期限をドロップした日に設定する |

- 1 日単位でスナップする。ドラッグ中は移動後の期間（例 `10/8 – 10/14`）をバー近くに表示する。
- 移動量が 0 日なら保存しない。4px 未満の移動はクリックとして扱う。
- ドラッグ中に `Escape` で取り消す。
- ドラッグ中は `touch-action: none` をバーとハンドルにだけ付け、時間軸の横スクロールは妨げない。
- 未スケジュール欄からのドロップ先は、ポインタの x 座標の日付。y 座標（どのグループの行か）は無視し、担当者やマイルストーンは変えない。

### 未スケジュール欄

- 開始日も期限もない、`done` 以外の課題を、時間軸の下に横並びのチップで出す（番号昇順）。グループ切替や `milestone` 絞り込みは同じく効く。
- 0 件なら欄ごと出さない。

### 権限による出し分け

- 課題ごとにサーバーが `canEdit = !project.archivedAt && can(actor, 'issue:edit', res)` を返す（`issue.remote.ts` の `edit` と同じ判定）。
- `canEdit` が false のバー・チップはドラッグできず、伸縮ハンドルを出さない。クリックでの遷移はできる。
- アーカイブ済みプロジェクトではすべて閲覧のみ。

### 保存と失敗時

- ドロップ時に楽観的にバーを新しい位置へ動かし、`command` を呼ぶ。
- 失敗したら元の位置に戻し、`$lib/toast.svelte` でエラーメッセージを出す（ボードと同じ流れ）。
- 成功したら `getTimeline(...).refresh()` で再取得する。

## 3. サーバー

### サービス（`src/lib/server/services/issues.ts`）

- `listColumns` に `startDate: issue.startDate` を追加する（一覧・ボードには影響なし）。
- 次を追加する。

```ts
export interface TimelineItem extends IssueListItem {
	canEdit: boolean;
}

export async function listTimeline(
	ctx: AppContext,
	key: string,
	filters: { milestoneId?: string } = {}
): Promise<{ scheduled: TimelineItem[]; unscheduled: TimelineItem[] }>;
```

- `requireProject` で参加確認（未参加は `not_found`）。
- `scheduled`: 開始日か期限のどちらかがある課題すべて（`done` を含む）。表示範囲では絞らない。範囲外の課題も行として出し、行ラベルに「◀」「▶」を出すため。1 プロジェクトの課題は数百件程度を想定しており、この件数なら全件返して問題ない。件数が問題になったら範囲で絞り、範囲外表示をやめる。
- `unscheduled`: 開始日も期限もなく、`status != 'done'` の課題。
- `milestoneId` は既存の `filterConds` に渡し、`'none'` の扱いも一覧・ボードと同じにする。
- `canEdit` は上記 §2「権限による出し分け」の式で計算する。

グループ分けと並べ替えはクライアント側の純関数（§4）で行う。サーバーは平らな配列を返す。

### リモート関数（`src/routes/projects/[key]/timeline/timeline.remote.ts`）

```ts
const TimelineRef = v.object({ key: v.string(), milestone: v.string() });

export const getTimeline = query(TimelineRef, ...);
// → { ...listTimeline(...), milestones: listMilestones(...) }

export const setIssueDates = command(
	v.object({
		...TimelineRef.entries,
		number: v.number(),
		startDate: v.string(), // '' は未設定
		dueDate: v.string()
	}),
	...
);
// → updateIssue(ctx, key, number, { startDate, dueDate }) を呼び、getTimeline を refresh
```

- 日付の更新は既存の `updateIssue` を通す。`issue:edit` の権限判定、`assertDateRange`、アーカイブ済みの拒否、`YYYY-MM-DD` の形式検証はそちらに任せる。新しい権限 Action は追加しない。
- 担当者別グループの見出しは課題の `assigneeName` で足りるため、参加者一覧は取得しない。
- `+page.server.ts` は作らず、ボードと同じくリモート関数だけで読み込む。

## 4. クライアント構成

| ファイル | 役割 |
|---|---|
| `src/lib/timeline.ts` | 日付計算の純関数（DOM 非依存）。下表 |
| `src/lib/timeline.test.ts` | 上の単体テスト |
| `src/routes/projects/[key]/timeline/+page.svelte` | ツールバー、クエリ同期、`getTimeline` の読み込み、楽観更新とトースト |
| `src/routes/projects/[key]/timeline/TimelineGrid.svelte` | 見出し、グループと行、バーの描画、ドラッグ処理 |
| `src/routes/projects/[key]/timeline/timeline.remote.ts` | §3 |

`src/lib/timeline.ts` の関数:

| 関数 | 内容 |
|---|---|
| `addDays(date, n)` / `diffDays(a, b)` | `YYYY-MM-DD` の加減算と差。UTC で計算し、タイムゾーンや夏時間の影響を受けない |
| `mondayOf(date)` / `todayLocal()` | 週の月曜、ブラウザのローカル日付 |
| `viewRange(from, scale)` | `{ from, to, days, dayWidth, step }` |
| `barSpan(item, range)` | 表示用の `{ startCol, endCol, clippedStart, clippedEnd, missingStart, missingDue }`。範囲外なら `null` と方向 |
| `applyDrag(item, mode, deltaDays)` | `mode`: `move` / `start` / `end`。新しい `{ startDate, dueDate }` を返す。開始日 ≦ 期限を保つよう丸める |
| `groupItems(items, group, milestones)` | §2 の並び順でグループ化し、見出しの `done / total` を付ける |

## 5. エラー処理

- 読み込みエラーは `runQuery`、保存エラーは `runCommand`（既存の `remote-helpers`）で本体設計書 §9 に沿って変換する。
- 保存時の `validation`（開始日 > 期限など）と `forbidden` / `not_found` は、楽観更新を戻してトーストで知らせる。クライアントも `applyDrag` で開始日 ≦ 期限を保つため、通常は起きない。
- 他の人が同時に同じ課題を変えた場合は後勝ち（既存の課題編集と同じ）。保存後の再取得で最新に揃う。

## 6. テスト

- **Vitest（services）** `issues.test.ts` に追加:
  - `listTimeline` が日付ありを `scheduled`、日付なしかつ未完了を `unscheduled` に分け、日付なしの `done` を除く。
  - `milestone` 絞り込み（ID / `none`）。
  - `canEdit`: admin / member は true、guest は自分が起票した課題だけ true、アーカイブ済みは全員 false。
  - 未参加者は `not_found`。
- **Vitest（純関数）** `timeline.test.ts`:
  - 月末・年末をまたぐ `addDays` / `diffDays`、`mondayOf`。
  - `barSpan` の範囲端での切り取り、片方の日付だけの課題。
  - `applyDrag` の各モード、開始日 ≦ 期限の丸め、欠けた日付の補完。
  - `groupItems` の並び順と「未割当」「マイルストーンなし」の位置、進捗の件数。
- **E2E（Playwright）**:
  - member がバーを右へ 2 日ドラッグ → 課題詳細で開始日・期限が 2 日後になっている。
  - member が未スケジュール欄のチップをタイムラインへドロップ → 開始日・期限が設定され、欄から消える。
  - guest には自分が起票していない課題のバーに伸縮ハンドルが出ず、ドラッグしても日付が変わらない。

## 7. ドキュメント（apps/docs）

使い方のページに「タイムライン」を追加する。グループ切替、ドラッグでの日付変更、未スケジュール欄、権限（ゲストは自分が起票した課題だけ動かせる）を書く。
