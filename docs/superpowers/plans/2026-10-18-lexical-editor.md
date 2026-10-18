# Markdown の見たまま編集（Lexical）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 課題の本文とコメントの入力欄を、Markdown で保存する見たまま編集エディタ（Lexical）に置き換え、表示側もエディタと同じ解析処理に移す。

**Architecture:** 今の textarea をフォームの値の持ち主として残し、その上に Lexical の編集領域を重ねる。Lexical は動的 import で後から読み込み、内容が変わったら Markdown に書き出して textarea に入れる。表示側（サーバ）は markdown-it をやめ、`mdast-util-from-markdown` → hast → HTML にする。メンションの解析は、エディタと表示で共通の mdast 拡張にする。

**Tech Stack:** SvelteKit 3 / Svelte 5、Lexical 0.52.0（`lexical`・`@lexical/*` を完全一致で固定）、`@lexical/mdast`、micromark / mdast-util 系、`mdast-util-to-hast`、`hast-util-to-html`、`linkify-it`、vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-18-lexical-editor-design.md`

## Global Constraints

- `lexical` と `@lexical/*` はすべて `0.52.0` に完全一致で固定する（`^` を付けない）。版がずれると Lexical は動かない。
- svelte-lexical と `@lexical/react` は使わない。
- 保存形式は Markdown 文字列のまま。DB のスキーマは変えない（マイグレーションなし）。
- メンションの保存形式は `@[表示名](user:<uuid>)`（`$lib/mentions` の `MENTION_SOURCE`）のまま。
- UI の文言は日本語、アイコンは `@lucide/svelte`。
- 編集を始める前のページ表示に、Lexical のコードを含めない（動的 import のみ）。
- 表示側で生の HTML は文字としてエスケープする。リンクと画像は `http:` `https:` `mailto:` と `/` で始まる URL だけを許可する。
- 何も直さずに保存したときは、保存される文字列が元と同じであること。
- 段落内の 1 回の改行は表示で `<br>` にする。
- 変換確定中（`isComposing`）の Enter で、メンションの確定や段落の分割をしない。
- 各タスクの終わりに `pnpm check` と `pnpm test:unit` を通してからコミットする（`apps/web` で実行）。コミットメッセージは `feat(web): ...` / `fix(web): ...` / `test(web): ...` の形。

## Review Focus

1. **編集中に「Markdown で編集」に切り替えて戻す**: 見たまま→ソース→見たままで、内容が失われない・二重にならない。→ Task 4 の E2E に追加。
2. **投稿後のコメント欄のリセット**: `form.reset()` や remote form の送信成功後、エディタも空に戻る。投稿に失敗したら入力が残る。→ Task 4 の E2E に追加。
3. **日本語入力の変換中**: 変換中の Enter で段落が分かれない。`@` の後の変換中に候補が誤って確定しない。→ Task 5 に、`isComposing` の keydown を無視する単体テストを追加。
4. **アップロード中に保存しようとする**: 見たまま編集のモードでも、今と同じく送信が止まり「アップロードが終わってから送信してください」が出る。→ Task 6 の E2E に追加。
5. **空の本文と空白だけの本文**: 空のまま開いて保存しても `''` のまま。コメントの `required` が、見たまま編集のモードでも空の送信を止める。→ Task 3 の単体テストと Task 4 の E2E に追加。

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/lib/markdown/mention-mdast.ts`（新規） | メンションの mdast 拡張（解析時の変換・Markdown への書き出し）。サーバとブラウザで共有 |
| `src/lib/markdown/mention-mdast.test.ts`（新規） | 上のテスト |
| `src/lib/server/linkify-mdast.ts`（新規） | mdast のテキスト中の URL を、markdown-it と同じ規則（linkify-it）でリンクにする |
| `src/lib/server/markdown.ts`（書き換え） | `renderMarkdown` の中身を mdast → hast → HTML にする |
| `src/lib/server/markdown.test.ts`（追記） | 既存のテストはそのまま。新しいケースと markdown-it との比較を追加 |
| `src/lib/editor/nodes.ts`（新規） | Lexical の独自ノード: `MentionNode`・`ImageNode`・`RawMarkdownNode`・`UploadPlaceholderNode` |
| `src/lib/editor/create-editor.ts`（新規） | エディタを組み立て、Markdown を読み書きする。動的 import の入口 |
| `src/lib/editor/create-editor.test.ts`（新規） | 往復・未編集時の文字列保持のテスト（happy-dom 環境） |
| `src/lib/editor/commands.ts`（新規） | ツールバーの操作と、書式の状態の取得 |
| `src/lib/editor/paste.ts`（新規） | 外からの貼り付けの書式の整理 |
| `src/lib/editor/uploads.ts`（新規） | Lexical 上での添付の挿入（アップロード中の仮の要素 → 画像・リンク） |
| `src/lib/components/MarkdownEditor.svelte`（書き換え） | textarea とエディタ・ツールバー・モード切り替え |
| `src/lib/components/EditorMentionMenu.svelte`（新規） | Lexical 用のメンション候補 |
| `src/routes/projects/[key]/issues/[number=int]/IssueView.svelte`（変更） | 3 か所の textarea を `MarkdownEditor` に置き換え |
| `src/routes/projects/[key]/issues/new/+page.svelte`（変更なし予定） | 既に `MarkdownEditor` を使っている。props が変われば合わせる |
| `src/routes/layout.css`（変更） | `.markdown` のスタイルを編集領域にも当てる。表・見出し・引用・区切り線のスタイルを足す |
| `e2e/main-flow.spec.ts`（変更） | 入力欄の取り方を新しいエディタに合わせ、見たまま編集のケースを追加 |

---

### Task 1: メンションの mdast 拡張

**Files:**
- Create: `src/lib/markdown/mention-mdast.ts`
- Test: `src/lib/markdown/mention-mdast.test.ts`

**Interfaces:**
- Consumes: `MENTION_SOURCE`（`$lib/mentions`）
- Produces:
  - `interface MentionMdast { type: 'mention'; name: string; userId: string }`（`declare module 'mdast'` で `PhrasingContentMap` に `mention` を足す）
  - `mentionFromMarkdown(): import('mdast-util-from-markdown').Extension`。`transforms` で、`@` で終わる text の直後にある、URL が `user:<uuid>` のリンク（子が表示名のテキスト 1 つ）を `mention` ノードに置き換え、text の末尾の `@` を消す。uuid が `MENTION_SOURCE` に合わないものは置き換えない。
  - `mentionToMarkdown(): import('mdast-util-to-markdown').Options`。`mention` を `mentionToken({ id, name })` の形で書き出す。

- [ ] **Step 1: 依存を追加する**

`pnpm add mdast-util-from-markdown@2.1.0 mdast-util-to-markdown micromark-util-types` と `pnpm add -D @types/mdast`。

- [ ] **Step 2: 失敗するテストを書く**

```ts
const id = '0192f0c1-0000-7000-8000-000000000001';
const parse = (md: string) => fromMarkdown(md, { mdastExtensions: [mentionFromMarkdown()] });
const stringify = (tree: Root) => toMarkdown(tree, { extensions: [mentionToMarkdown()] });

it('@[名前](user:uuid) を mention ノードにする', () => {
	const p = parse(`hi @[田中 太郎](user:${id}) さん`).children[0] as Paragraph;
	expect(p.children).toEqual([
		expect.objectContaining({ type: 'text', value: 'hi ' }),
		expect.objectContaining({ type: 'mention', name: '田中 太郎', userId: id }),
		expect.objectContaining({ type: 'text', value: ' さん' })
	]);
});
it('コード内は置き換えない', () => {
	expect(JSON.stringify(parse('`@[a](user:' + id + ')`'))).not.toContain('"mention"');
});
it('uuid が不正なら置き換えない', () => {
	expect(JSON.stringify(parse('@[a](user:xyz)'))).not.toContain('"mention"');
});
it('@ が直前にないリンクは置き換えない', () => {
	expect(JSON.stringify(parse(`[a](user:${id})`))).not.toContain('"mention"');
});
it('元の記法に書き戻す', () => {
	expect(stringify(parse(`hi @[田中 太郎](user:${id}) さん`)).trim()).toBe(
		`hi @[田中 太郎](user:${id}) さん`
	);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/markdown/mention-mdast.test.ts`
Expected: FAIL（`mentionFromMarkdown` がない）

- [ ] **Step 4: `mention-mdast.ts` を実装する**

置き換えは `unist-util-visit` を使わず、段落などの `children` を順に見て「`@` で終わる text + link」の組を探す（依存を増やさないため）。書き出しの handler は、表示名とその前後をエスケープせずに `mentionToken` の文字列をそのまま返す（`mentionToken` が `]` と改行を既に除いている）。

- [ ] **Step 5: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/markdown/mention-mdast.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

`feat(web): add mention mdast extension shared by renderer and editor`

---

### Task 2: 表示側を mdast に移す

**Files:**
- Create: `src/lib/server/linkify-mdast.ts`
- Modify: `src/lib/server/markdown.ts`（全体を書き換え）
- Test: `src/lib/server/markdown.test.ts`（追記のみ。既存の 8 件は変えない）

**Interfaces:**
- Consumes: `mentionFromMarkdown()`（Task 1）
- Produces: `renderMarkdown(src: string): string`（シグネチャは今と同じ）、`linkifyMdast(tree: Root): void`

- [ ] **Step 1: 依存を追加する**

`pnpm add micromark-extension-gfm-strikethrough mdast-util-gfm-strikethrough micromark-extension-gfm-table mdast-util-gfm-table micromark-extension-gfm-task-list-item mdast-util-gfm-task-list-item mdast-util-to-hast hast-util-to-html linkify-it`。`markdown-it` は `dependencies` から `devDependencies` に移す（比較テストだけで使う）。

- [ ] **Step 2: 失敗するテストを書く**

`markdown.test.ts` に追記する。比較用に `markdown-it` を `{ html: false, linkify: true, breaks: true }` で作り、自動リンクの結果を比べる。

```ts
it('打ち消し線', () => expect(renderMarkdown('~~x~~')).toContain('<del>x</del>'));
it('チェックリスト', () => {
	const html = renderMarkdown('- [ ] a\n- [x] b');
	expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
	expect(html).toMatch(/<input[^>]*checked/);
});
it('ネストした箇条書き', () =>
	expect(renderMarkdown('- a\n  - b')).toMatch(/<li>a\s*<ul>\s*<li>b<\/li>/));
it('段落内の 1 回の改行は <br>', () => expect(renderMarkdown('a\nb')).toMatch(/a<br>\s*b/));
it('表', () => expect(renderMarkdown('| a |\n| - |\n| b |')).toContain('<table>'));
it('mailto と相対 URL はリンクにする', () => {
	expect(renderMarkdown('[m](mailto:a@example.com)')).toContain('href="mailto:a@example.com"');
	expect(renderMarkdown('[f](/projects/A/attachments/1)')).toContain('href="/projects/A/attachments/1"');
});
it('許可しないプロトコルの画像は出さない', () =>
	expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('javascript:'));
it.each([
	'see example.com',
	'詳細はhttps://example.com/です',
	'https://example.com/a?b=1。',
	'(https://example.com)',
	'mail a@example.com'
])('自動リンクは markdown-it と同じ: %s', (src) => {
	expect(hrefs(renderMarkdown(src))).toEqual(hrefs(legacy.render(src)));
});
```

`hrefs(html)` は `href="..."` を抜き出して配列にする、テストファイル内の小さな関数。

- [ ] **Step 3: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/server/markdown.test.ts`
Expected: 追加分が FAIL、既存の 8 件は PASS

- [ ] **Step 4: `linkifyMdast` を実装する**

`linkify-it` を markdown-it と同じ設定で作る（markdown-it 15 の `lib/index.mjs` で `linkify` をどう設定しているか確認して合わせる）。text ノードの値に `match` をかけ、text と link に分ける。`code`・`inlineCode`・`link`・`linkReference` の中は対象にしない。URL の検証は下の `isAllowedUrl` を通す。

- [ ] **Step 5: `renderMarkdown` を実装する**

処理の順番（ここが決め所）:

1. `fromMarkdown(src, { extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem()], mdastExtensions: [..., mentionFromMarkdown()] })`
2. `html` ノード（ブロックもインラインも）を同じ値の `text` ノードに置き換える（生の HTML を文字で表示する）
3. `linkifyMdast(tree)`
4. `code`・`inlineCode` 以外の text の `\n` で text を分け、間に `break` ノードを入れる（`breaks: true` 相当）
5. `toHast(tree, { handlers: { mention, link, image } })`
   - `mention` → `<span class="mention">@{name}</span>`
   - `link` → `isAllowedUrl(url)` でなければ子だけを出す。許可なら `rel="noopener noreferrer nofollow"` と `target="_blank"` を付ける
   - `image` → 許可しない URL なら何も出さない。許可なら `<span class="md-img"><img src alt></span>`
6. `toHtml(hast)`

`isAllowedUrl(url: string): boolean` は、`/` で始まる（`//` を除く）か、プロトコルが `http:` `https:` `mailto:` のときだけ true。チェックリストの `<input>` は `mdast-util-to-hast` の標準出力（`disabled` 付き）に任せる。

- [ ] **Step 6: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/server`
Expected: PASS（既存 8 件と追加分のすべて）。既存の画像テストは `<img src="/a.png" alt="shot">` の完全一致なので、属性の順番を合わせる。

- [ ] **Step 7: Commit**

`feat(web): render markdown via mdast with linkify-it compatible autolinks`

---

### Task 3: Lexical エディタの中核（読み書きと独自ノード）

**Files:**
- Create: `src/lib/editor/nodes.ts`、`src/lib/editor/create-editor.ts`
- Test: `src/lib/editor/create-editor.test.ts`（先頭に `// @vitest-environment happy-dom`）

**Interfaces:**
- Consumes: `mentionFromMarkdown()` / `mentionToMarkdown()`（Task 1）
- Produces:
  ```ts
  export interface MarkdownEditorHandle {
  	editor: LexicalEditor;
  	/** Markdown を読み込み、未編集の基準を取り直す */
  	setMarkdown(md: string): void;
  	/** 未編集なら setMarkdown で渡した文字列そのものを返す */
  	getMarkdown(): string;
  	destroy(): void;
  }
  export function createMarkdownEditor(opts: {
  	root?: HTMLElement | null;
  	onChange?: (markdown: string) => void;
  }): MarkdownEditorHandle;
  ```
  `nodes.ts` から:
  - `$createMentionNode(name: string, userId: string)`
  - `$createImageNode(src: string, alt: string)`
  - `$createUploadPlaceholderNode(key: string, filename: string)`
  - `$isUploadPlaceholderNode(node)`
  - `MentionNode`・`ImageNode`・`RawMarkdownNode`・`UploadPlaceholderNode`

- [ ] **Step 1: 依存を追加する**

`pnpm add lexical@0.52.0 @lexical/mdast@0.52.0 @lexical/extension@0.52.0 @lexical/rich-text@0.52.0 @lexical/list@0.52.0 @lexical/link@0.52.0 @lexical/history@0.52.0 @lexical/selection@0.52.0 @lexical/utils@0.52.0 @lexical/html@0.52.0 @lexical/clipboard@0.52.0` と `pnpm add -D happy-dom`。`package.json` で、`lexical` と `@lexical/*` の版が `^` なしの `0.52.0` になっていることを確認する。

- [ ] **Step 2: 失敗するテストを書く**

```ts
const id = '0192f0c1-0000-7000-8000-000000000001';
const roundtrip = (md: string) => {
	const h = createMarkdownEditor({});
	h.setMarkdown(md);
	h.editor.update(() => $getRoot().getLastDescendant()?.markDirty(), { discrete: true });
	return h;
};
const samples = [
	'- a\n  - b\n    - c',
	'- [ ] todo\n- [x] done',
	'3. three\n4. four',
	'# 見出し\n\n> 引用\n\n---',
	'```ts\nconst a = 1;\n```',
	'| a | b |\n| - | - |\n| 1 | 2 |',
	'<br> と <b>x</b>',
	`hi @[田中 太郎](user:${id}) さん`,
	'![shot](/projects/A/attachments/1)',
	'1 行目\n2 行目',
	'~~消す~~ **太字** `code` [l](https://example.com)',
	'see example.com'
];
it.each(samples)('未編集なら元の文字列のまま: %s', (md) => {
	const h = createMarkdownEditor({});
	h.setMarkdown(md);
	expect(h.getMarkdown()).toBe(md);
});
it.each(samples)('書き出しても表示は変わらない: %s', (md) => {
	expect(renderMarkdown(roundtrip(md).getMarkdown())).toBe(renderMarkdown(md));
});
it('空のままなら空', () => {
	const h = createMarkdownEditor({});
	h.setMarkdown('');
	expect(h.getMarkdown()).toBe('');
});
it('表は編集できないブロックとして元の Markdown を保つ', () => {
	const md = 'x\n\n| a |\n| - |\n| 1 |';
	expect(roundtrip(md).getMarkdown()).toContain('| a |\n| - |\n| 1 |');
});
it('1 回の改行は LineBreakNode として読む', () => {
	const h = createMarkdownEditor({});
	h.setMarkdown('a\nb');
	h.editor.read(() =>
		expect($getRoot().getFirstChildOrThrow<ElementNode>().getChildren().some($isLineBreakNode)).toBe(true)
	);
});
it('アップロード中の仮の要素は書き出さない', () => {
	const h = createMarkdownEditor({});
	h.setMarkdown('a');
	h.editor.update(() => $getRoot().getFirstChildOrThrow<ElementNode>().append($createUploadPlaceholderNode('k', 'f.png')), { discrete: true });
	expect(h.getMarkdown()).toBe('a');
});
```

`renderMarkdown` は `$lib/server/markdown` から import する（テストからの import なので問題ない）。

- [ ] **Step 3: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/editor`
Expected: FAIL（`createMarkdownEditor` がない）

- [ ] **Step 4: `nodes.ts` を実装する**

- `MentionNode`: `DecoratorNode` ではなく、編集できない inline の要素として作る（`TextNode` を継承して `isToken` / `isUnmergeable` にするか、`createDOM` が `<span class="mention">` を返す inline の `DecoratorNode`。Svelte の decorate は使わないので、DOM を直接作る方が簡単）。mdast の `mention` と相互に変換する。
- `ImageNode`: inline。`<span class="md-img"><img></span>` を作る。`importDOM` を定義しない（外から貼った画像を取り込まないため。§4.6）。mdast の `image` と相互に変換する。
- `RawMarkdownNode`: block の `DecoratorNode`。元の Markdown 文字列を持つ。表として読み込み、`createDOM` は `renderMarkdown` を使わずに、`<pre class="raw-md">` に元の文字列を出すか、簡単な `<table>` を作る（builder の判断）。書き出しでは文字列をそのまま出す（mdast に `{ type: 'rawMarkdown', value }` を出し、toMarkdown の handler で value を返す）。
- `UploadPlaceholderNode`: inline。「アップロード中: ファイル名」を表示する。書き出しでは何も出さない。

それぞれの import/export rule は `configExtension(MdastImportExtension, { importRules, exportRules, mdastExtensions, toMarkdownExtensions, micromarkExtensions })` で登録する（`@lexical/mdast` の README の「Define MyMdastExtension」の形）。表の取り込みのため、`micromarkExtensions` に `gfmTable()`、`mdastExtensions` に `gfmTableFromMarkdown()` を入れ、import rule の `type: 'table'` で、ノードの `position` の offset を使って元の文字列（`ctx.source.slice(start, end)`）を `RawMarkdownNode` に持たせる。

- [ ] **Step 5: `create-editor.ts` を実装する**

`buildEditorFromExtensions` に次を依存として渡す。`MdastGfmExtension` は使わない（自動リンクと表が入るため）。

- `MdastHeadingExtension`、`MdastBlockquoteExtension`、`MdastListExtension`、`MdastCodeExtension`、`MdastLinkExtension`、`MdastHorizontalRuleExtension`
- `MdastStrikethroughExtension`、`MdastTaskListExtension`
- `MdastExtension`、`MdastShortcutsExtension`
- `RichTextExtension`、`HistoryExtension`
- Task 3 の独自ノードの拡張

ネストの上限は設けない。

未編集の扱い（§4.3）:
- `setMarkdown(md)` で `$convertFromMarkdownString(md)` を呼び、直後に `$convertToMarkdownString()` を `baseline` として覚え、`source = md` も覚える。
- `getMarkdown()` は、書き出した結果が `baseline` と同じなら `source` を、違えば書き出した結果を返す。
- `onChange` は `registerUpdateListener` で、`dirtyElements` / `dirtyLeaves` があるときだけ `getMarkdown()` を渡して呼ぶ。

`root` を渡されたら `editor.setRootElement(root)` する。

- [ ] **Step 6: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/editor`
Expected: PASS。往復で表示が変わるサンプルがあれば、そのサンプル用の import/export rule を直す（サンプルを消さない）。

- [ ] **Step 7: Commit**

`feat(web): add Lexical markdown editor core with custom nodes`

---

### Task 4: MarkdownEditor コンポーネント（textarea との同期、モード、ツールバー）

**Files:**
- Create: `src/lib/editor/commands.ts`
- Modify: `src/lib/components/MarkdownEditor.svelte`（書き換え）、`src/routes/layout.css`
- Test: `e2e/main-flow.spec.ts`（課題作成の部分。Task 8 で他の場所も直す）

**Interfaces:**
- Consumes: `createMarkdownEditor`（Task 3。動的 import で読み込む）
- Produces:
  - `MarkdownEditor.svelte` の props:
    ```ts
    HTMLTextareaAttributes & {
    	value?: string; // $bindable
    	projectKey?: string;
    	mentionCandidates?: MentionCandidate[];
    	label: string; // 編集領域の aria-label（例: 'コメントを追加'）
    }
    ```
    `rest` は textarea にそのまま渡す（`name`、remote form の `.as(...)`、`form`、`required`、`id`、`rows`、`placeholder`）。
  - `commands.ts`:
    - `type Format = 'bold' | 'strikethrough' | 'code' | 'link' | 'bullet' | 'check'`
    - `runFormat(editor: LexicalEditor, f: Format): void`
    - `activeFormats(editor: LexicalEditor): Set<Format>`（`editor.read` 内で現在の選択から求める）
    - `setLink(editor: LexicalEditor, url: string | null): void`

- [ ] **Step 1: 失敗する E2E を書く**

`main-flow.spec.ts` の課題作成の部分を、次の操作に直す。編集領域は `page.getByRole('textbox', { name: '本文' })` で取る（隠れた textarea は role の検索に入らない）。

1. 本文の編集領域で `- 親` を入力し、Enter → Tab → `子` と入力する。
2. 太字ボタン（`getByRole('button', { name: '太字' })`）を押して `強調` と入力する。
3. 起票すると、詳細の `.markdown` に `ul ul li` の「子」と `strong` の「強調」が表示される。

Review Focus 1・5 の E2E も同じ場所に追加する:
- 本文に `abc` と入力し、「Markdown で編集」を押す → textarea の値が `abc` → `d` を足して戻す → 編集領域に `abcd` が表示され、`abc` が二重にならない。
- コメントの `required`: 見たまま編集のモードで空のまま「コメントする」を押しても送信されない（コメント数が増えない）。

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm test:e2e -g "<該当テスト名>"`
Expected: FAIL（textbox が見つからない）

- [ ] **Step 3: `commands.ts` を実装する**

Lexical の `FORMAT_TEXT_COMMAND`（bold / strikethrough / code）、`INSERT_UNORDERED_LIST_COMMAND`、`INSERT_CHECK_LIST_COMMAND`、`TOGGLE_LINK_COMMAND` を使う。複数行の選択でのコードは、コードブロック（`$createCodeNode`）にする（今と同じ挙動）。

- [ ] **Step 4: `MarkdownEditor.svelte` を書き換える**

- textarea は今どおり描画し、`bind:value` と `rest` を渡す。見たまま編集のモードでは `hidden` 属性を付けるが、`required` などの検証は textarea で行う。hidden の textarea には `required` の吹き出しが出ないので、`form` の `submit`（capture）で値が空なら `preventDefault` し、編集領域にフォーカスして `setCustomValidity` 相当のメッセージ（「入力してください」）を表示する。
- マウント後、`requestIdleCallback`（ない環境は `setTimeout(…, 200)`）で `import('$lib/editor/create-editor')` し、`contenteditable` の div を root にして作る。読み込みが終わるまでは textarea を見せる。
- エディタの `onChange(md)` で、`textarea.value = md` にして `input` イベントを発火する（`bind:value`・remote form に伝える）。
- textarea の `input`（エディタ以外から。例: ソースモードでの入力）と `form` の `reset`（`requestAnimationFrame` 後）で `setMarkdown(textarea.value)` する。自分で発火した `input` は、フラグで無視する。
- モード: `'rich' | 'source'`。`localStorage` の `md-editor-mode` に覚える（`try/catch` で囲む）。切り替え時は、source→rich で `setMarkdown(textarea.value)` する。
- 編集領域: `role="textbox"`、`aria-multiline="true"`、`aria-label={label}`、`class="markdown editor-body"`。空のときは `placeholder` を重ねて表示する。
- 高さ: 最小は `rows` × 行の高さ（1.7em）。上限は、今の `.textarea.autosize` の `max-height` と同じにし、超えたらスクロールする。
- ツールバー: 左から 太字（`Bold`）・打ち消し線（`Strikethrough`）・コード（`Code`）・リンク（`Link`）・箇条書き（`List`）・チェックリスト（`ListChecks`）・添付・「Markdown で編集」（`FileCode`、`aria-pressed`）。`aria-label` / `title` は日本語。`activeFormats` の結果でボタンに `aria-pressed` と `.active` を付ける（`registerUpdateListener` で更新）。ソースモードでは、書式のボタンを今の textarea 用の処理（今の `wrap` / `prefixLines`）で動かす。
- リンク: 押すと小さなポップオーバーで URL を入力し、Enter で `setLink`。
- Tab / Shift+Tab: リストの中なら `INDENT_CONTENT_COMMAND` / `OUTDENT_CONTENT_COMMAND`。リストの外では何もしない（フォーカス移動のまま）。
- ヒントの文言は今の `MarkdownEditor` のものを引き継ぐ。

- [ ] **Step 5: スタイルを足す**

`layout.css` の `.markdown` に、`h1`〜`h6`・`blockquote`・`hr`・`table`・チェックリストの見た目を足す（表示と編集領域の両方に効く）。Lexical のテーマのクラス（太字や打ち消し線など）は、`.markdown` の中で `<strong>` / `<del>` と同じ見た目になるようにする。

- [ ] **Step 6: テストが通ることを確認する**

Run: `pnpm check && pnpm test:unit --run && pnpm test:e2e -g "<該当テスト名>"`
Expected: PASS

- [ ] **Step 7: Commit**

`feat(web): WYSIWYG markdown editor component with source mode toggle`

---

### Task 5: エディタ上のメンション

**Files:**
- Create: `src/lib/components/EditorMentionMenu.svelte`、`src/lib/editor/mention-query.ts`
- Test: `src/lib/editor/mention-query.test.ts`（happy-dom）
- Modify: `src/lib/components/MarkdownEditor.svelte`

**Interfaces:**
- Consumes: `findMentionQuery`・`filterCandidates`（`$lib/mentions`）、`$createMentionNode`（Task 3）
- Produces:
  - `currentMentionQuery(editor: LexicalEditor): { query: string; rect: DOMRect | null } | null`（選択が折りたたまれた text の中にあるとき、そのノードの先頭からキャレットまでの文字列に `findMentionQuery` をかける）
  - `insertMention(editor: LexicalEditor, c: MentionCandidate): void`（`@query` を消して `MentionNode` と空白 1 つを入れる）
  - `shouldHandleMenuKey(e: KeyboardEvent): boolean`（`e.isComposing` なら false）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('@ の後の文字列を返す', () => { /* 'hi @ta' を入れてキャレットを末尾に → query === 'ta' */ });
it('確定で @query がメンションに置き換わる', () => {
	// 'hi @ta' → insertMention → getMarkdown() === `hi @[田中](user:${id}) `
});
it('変換中の Enter は扱わない', () => {
	expect(shouldHandleMenuKey(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(false);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/editor/mention-query.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

`EditorMentionMenu.svelte` は今の `MentionMenu.svelte` と同じ見た目と操作（`role="listbox"`、`aria-label="メンションする人"`、↑↓ / Enter / Tab / Esc）。キーは `KEY_DOWN_COMMAND` 系のコマンドを `COMMAND_PRIORITY_HIGH` で受け、メニューが開いているときだけ処理して true を返す。位置は `window.getSelection().getRangeAt(0).getBoundingClientRect()` から求める。ソースモードでは今の `MentionMenu` を使う。

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/editor`
Expected: PASS

- [ ] **Step 5: Commit**

`feat(web): mention typeahead in the WYSIWYG editor`

---

### Task 6: エディタ上の添付

**Files:**
- Create: `src/lib/editor/uploads.ts`
- Modify: `src/lib/attachment-upload.ts`（`trackUpload` を export する）、`src/lib/components/MarkdownEditor.svelte`、`src/lib/components/AttachButton.svelte`
- Test: `src/lib/editor/uploads.test.ts`（happy-dom）

**Interfaces:**
- Consumes: `uploadFile`・`trackUpload`（`$lib/attachment-upload`）、`shouldUploadPaste`（`$lib/attachment-rules`）、`$createUploadPlaceholderNode` / `$createImageNode`（Task 3）
- Produces:
  - `insertUploadsIntoEditor(editor: LexicalEditor, form: HTMLFormElement | null, projectKey: string, files: Iterable<File>, upload?: typeof uploadFile): Promise<void>`（1 件ずつ順に。テスト用に `upload` を差し替えられる）
  - `AttachButton` の props を `{ projectKey: string; onFiles: (files: File[]) => void }` に変える（どちらのモードかを呼び出し側が決める）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('アップロード中は仮の要素を出し、終わったら画像に置き換える', async () => {
	// upload は解決を待たせる Promise を返す fake
	// 待っている間: getMarkdown() に何も足されていない & UploadPlaceholderNode がある
	// 解決後: getMarkdown() に '![a.png](/projects/A/attachments/1)' が入る
});
it('画像以外はリンクにする', async () => { /* '[spec.pdf](/projects/A/attachments/2)' */ });
it('失敗したら仮の要素を消す', async () => { /* upload が reject → placeholder なし、Markdown は元のまま */ });
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/editor/uploads.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

置き換えは、仮の要素を `key`（ランダムな文字列）で探し、見つからなければ（ユーザーが消した）何もしない。画像は `$createImageNode(url, filename)`、それ以外は `$createLinkNode(url)` に `filename` のテキストを入れたもの。失敗時は `toast.error`（今と同じ文言）。送信の停止は `trackUpload(form)` を使う。

`MarkdownEditor.svelte` では、`PASTE_COMMAND` / `DROP_COMMAND` を受けて、`shouldUploadPaste` が true（ファイルを含む）なら `insertUploadsIntoEditor` を呼んで true を返す。ソースモードでは今の `uploadable` をそのまま使う。

アップロード中のモード切り替え: 仮の要素がある間は「Markdown で編集」ボタンを `disabled` にする（Claude の判断。仮の要素が保存されず、結果も失われない）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/editor`
Expected: PASS

- [ ] **Step 5: E2E を足す**

Review Focus 4: 見たまま編集のモードのコメント欄で、`attach-input` に PDF を入れ、アップロードを止めている間に「コメントする」を押す → 「アップロードが終わってから送信してください」が出る → 解除後に送信でき、`spec.pdf` のリンクが表示される。今の textarea 版のテスト（8.）は「Markdown で編集」に切り替えてから同じ操作をするように直す。

Run: `pnpm test:e2e`
Expected: PASS

- [ ] **Step 6: Commit**

`feat(web): paste, drop and attach files in the WYSIWYG editor`

---

### Task 7: 外からの貼り付けの整理

**Files:**
- Create: `src/lib/editor/paste.ts`
- Modify: `src/lib/editor/create-editor.ts`（拡張を登録）
- Test: `src/lib/editor/paste.test.ts`（happy-dom）

**Interfaces:**
- Consumes: `createMarkdownEditor`（Task 3）
- Produces: `PasteCleanupExtension`（`create-editor.ts` の依存に足す）

- [ ] **Step 1: 失敗するテストを書く**

`$generateNodesFromDOM` で HTML を取り込み、`$insertNodes` した後の `getMarkdown()` を確認する。

```ts
it('太字・リンク・リストは残す', () => {
	expect(paste('<p><b>a</b> <a href="https://x.test">l</a></p><ul><li>i</li></ul>')).toBe(
		'**a** [l](https://x.test)\n\n- i'
	);
});
it('文字色は捨てる', () =>
	expect(paste('<p><span style="color:red">a</span></p>')).toBe('a'));
it('外部の画像は取り込まない', () =>
	expect(paste('<p>a<img src="https://evil.test/x.png">b</p>')).toBe('ab'));
it('表はテキストになる', () =>
	expect(paste('<table><tr><td>1</td><td>2</td></tr></table>')).not.toContain('<table'));
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm test:unit --run src/lib/editor/paste.test.ts`
Expected: FAIL（文字色が残る、など）

- [ ] **Step 3: 実装する**

`TextNode` の node transform で `style` を空にする（貼り付けで付いたものも含め、style は使わないため常に空でよい）。`ImageNode` には `importDOM` がないので画像は落ちる（Task 3）。それでも残るものがあれば、`@lexical/html` の DOM import rule で `img` を捨てる rule を足す。

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm test:unit --run src/lib/editor`
Expected: PASS

- [ ] **Step 5: Commit**

`feat(web): keep only basic formatting when pasting rich text`

---

### Task 8: 4 か所の入力欄を置き換える

**Files:**
- Modify: `src/routes/projects/[key]/issues/[number=int]/IssueView.svelte`（本文・コメント新規・コメント編集の 3 か所）、`src/routes/projects/[key]/issues/new/+page.svelte`（`label` を足す）
- Test: `e2e/main-flow.spec.ts`

**Interfaces:**
- Consumes: `MarkdownEditor.svelte`（Task 4〜6）

- [ ] **Step 1: E2E を新しいエディタに合わせる**

- 6b のメンション: `page.getByRole('textbox', { name: 'コメントを追加' })` に `@顧客` と入力し、候補から選んで `確認お願いします` と入力する。値の確認は `page.locator('#new-comment')` の `toHaveValue(/^@\[顧客 太郎\]\(user:[0-9a-f-]{36}\) 確認お願いします$/)`。
- `getByLabel('コメントを追加')` を使っている所は、入力が role の textbox、値の確認が `#new-comment` になるように直す。
- タイムラインのシート（348 行目付近）の `getByLabel('コメントを追加').fill(...)` も同様に直す。
- Review Focus 2: コメントを投稿すると、編集領域が空に戻る。

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm test:e2e`
Expected: 置き換え前なので、textbox が見つからず FAIL

- [ ] **Step 3: 置き換える**

3 か所の `<textarea ...>` と、そのすぐ後の `<MentionMenu>`・`<AttachButton>` を `<MarkdownEditor>` 1 つにする。今の textarea の属性（`{...save.fields.description.as('text', issue.description)}`、`form={attrFormId}`、`rows`、`required`、`aria-label`、`id`、`bind:this` を使っている所は `value` か新しい props）を引き継ぐ。`label` は 本文＝`本文`、新規コメント＝`コメントを追加`、コメント編集＝`コメントを編集`、課題作成＝`本文`。課題詳細の本文のヒント「右／上の『保存』で反映されます」は、呼び出し側に残す。使われなくなった import（`autosize`・`uploadable`・`MentionMenu`）は消す（他で使っていればそのまま）。

- [ ] **Step 4: すべての検証を通す**

Run: `pnpm check && pnpm lint && pnpm test:unit --run && pnpm test:e2e`
Expected: すべて PASS

- [ ] **Step 5: Commit**

`feat(web): use the WYSIWYG editor for issue body and comments`

- [ ] **Step 6: プレビューにデプロイする**

`apps/web` で `CLOUDFLARE_ACCOUNT_ID=<memory の値> pnpm deploy:preview`。マイグレーションはない。URL と確認ポイント（箇条書きのネスト、ツールバー、Markdown で編集の切り替え、メンション、画像の貼り付け、既存の本文が開いて保存しても変わらないこと）をユーザーに伝える。
