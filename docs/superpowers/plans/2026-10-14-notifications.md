# 通知（アプリ内 + Webhook + メンション） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 課題の担当・ステータス変更・コメント・メンションを関係者にアプリ内で通知し、プロジェクトの出来事を Slack（Incoming Webhook）に投稿する。

**Architecture:** services の更新処理が確定した後に `notify(ctx, input)` を 1 回呼ぶ。`notify` は DB から関係者・受信可能ユーザー・Webhook 送信先をまとめて読み、純粋関数 `planNotifications` で受信者を決めて `notification` に一括 insert し、Webhook は `ctx.waitUntil` で送る。`notify` は例外を外に出さない。外部サービスは `WebhookProvider`（`build(event)` だけを持つ）をレジストリに足すだけで追加できる。

**Tech Stack:** SvelteKit 3（remote functions, adapter-cloudflare）、Svelte 5（runes, experimental async）、Drizzle 1.0 rc.4（turso dialect）、valibot、markdown-it、vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-14-notifications-design.md`

## Global Constraints

- 通知の type は `assigned` / `commented` / `status_changed` / `mentioned` の 4 つ。1 操作 1 人 1 件、優先度 `assigned` > `mentioned` > `commented` = `status_changed`。
- 操作した本人、無効化ユーザー、そのプロジェクトにアクセスできないユーザー（`project_member` にいない非 admin）には通知しない。担当を外したときは `assigned` を作らない。
- 関係者 = 起票者 ∪ 担当者（更新後）∪ コメントしたことがある人。
- メンション記法は `@[表示名](user:<uuid>)`。表示名は `]` と改行を含まない 1〜100 文字。コードブロック・インラインコード内は通知も描画もしない。
- Webhook の投稿文は「〇〇さんが <操作> しました。」の形。1 行目が文面、2 行目が `*<url|KEY-番号 タイトル>*`、context に補足。
- Slack の URL は `^https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+$` に一致するものだけ。それ以外は validation。
- Webhook の送信は 5 秒でタイムアウト、再送しない。失敗は `console.error` のみ。元の操作は常に成功させる。
- Webhook の管理（一覧・追加・削除・テスト送信）は admin のみ（`webhook:manage`）。URL は一覧でもマスクし、末尾 6 文字だけ見せる（表示は `•` 12 個 + 末尾 6 文字に固定。spec の「末尾 6 文字以外を • に置換」を画面幅に収めるための表示上の短縮）。
- `fetch` は `BaseContext.fetch` 経由で呼ぶ（テストで差し替えるため）。Workers では `fetch` を別オブジェクトのメソッドとして呼ぶと Illegal invocation になるので、hooks では `(input, init) => fetch(input, init)` を渡す。
- コマンドはすべて `apps/web` で実行する。コミットメッセージは `feat(web): ...` / `docs: ...` 形式。

### spec からの読み替え（意図は同じ）

- spec §6 の `ProjectEvent` は 2 つに分ける。services が渡す生のイベント `IssueEvent`（ID と本文だけ）と、名前・URL・抜粋を解決済みの `WebhookEvent`（プロバイダに渡す）。
- spec §7 の「未読数はルートの `+layout.server.ts` で読み込む」は、ルートレイアウトの load がナビゲーションごとに再実行されないため、remote query `getUnreadCount` をサイドバーで読み、遷移ごと + 60 秒ごとに `refresh()` する形にする。
- spec §7 の「課題詳細の load で既読化」は、詳細ページ表示時に command `readIssueNotifications` を呼ぶ形にする（GET の query に副作用を持たせない）。
- spec §5 の「`MarkdownEditor.svelte` に補完を追加」は、課題詳細が素の `<textarea>` を使っているため、どの textarea にも付けられる `MentionMenu.svelte`（`AttachButton` と同じ `target` 方式）にし、`MarkdownEditor` からもそれを使う。
- `WebhookProvider` にはテスト送信用の `buildTest(project)` を足す。

## Review Focus

1. **プロジェクトから外された人・無効化された人の古い通知**。期待する動作は、通知一覧・未読数に出ず（課題タイトルが漏れない）、既読化しようとしても `not_found`。テスト: Task 8。
2. **課題タイトルやコメントに `<!channel>` や `&`、`<@U123>` が含まれる場合**。期待する動作は、Slack でエスケープされて表示され、チャンネル全体への通知やユーザーへの誤メンションにならない。テスト: Task 6。
3. **コードブロック・インラインコード内に書かれたメンション記法**（使い方の説明など）。期待する動作は、通知されず、表示もバッジにならない。テスト: Task 1。
4. **メンションを含むコメントを、メンションを変えずに編集した場合**（誤字修正など）。期待する動作は、再通知されない。Slack にも投稿されない。テスト: Task 5、Task 6。
5. **表示名に `]` や改行を含むユーザー**。期待する動作は、補完で挿入したトークンが壊れず、正しい人に通知され、表示名から `]` と改行が除かれる。テスト: Task 1。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/lib/mentions.ts`（新規） | メンション記法・抽出・プレーン化・補完用の純粋関数（クライアント・サーバー共用） |
| `src/lib/mentions.test.ts`（新規） | 上記のテスト |
| `src/lib/server/markdown.ts` | メンションをバッジとして描画するインラインルール |
| `src/routes/layout.css` | `.mention` / `.mention-menu` のスタイル |
| `src/lib/server/db/schema.ts` | `notification` / `project_webhook` テーブル |
| `drizzle/<ts>_notifications/` | マイグレーション（drizzle-kit 生成） |
| `src/lib/server/authz.ts` | `webhook:manage` |
| `src/lib/server/context.ts` / `src/hooks.server.ts` / `src/lib/server/test-utils.ts` | `fetch` の受け渡し、テスト用の `fetched` / `pending` |
| `src/lib/server/notifications/recipients.ts`（新規） | 受信者計算（純粋関数） |
| `src/lib/server/notifications/events.ts`（新規） | `IssueEvent` / `NotifyInput` / `WebhookEvent` 型 |
| `src/lib/server/notifications/format.ts`（新規） | 本文の抜粋（Markdown 記号除去・切り詰め） |
| `src/lib/server/notifications/index.ts`（新規） | `notify()`：事実の読み込み → in-app insert → Webhook 送信 |
| `src/lib/server/notifications/webhooks/types.ts`（新規） | `WebhookProvider` |
| `src/lib/server/notifications/webhooks/slack.ts`（新規） | Slack 実装 |
| `src/lib/server/notifications/webhooks/index.ts`（新規） | レジストリ `providers`、`deliver()` |
| `src/lib/server/services/issues.ts` / `comments.ts` | `notify` の呼び出し |
| `src/lib/server/services/webhooks.ts`（新規） | Webhook の一覧・追加・削除・テスト送信 |
| `src/lib/server/services/notifications.ts`（新規） | 通知の一覧・未読数・既読化 |
| `src/lib/notifications.remote.ts` / `src/routes/notifications/`（新規） | 通知の remote functions（サイドバーと通知ページで共用）と通知ページ |
| `src/lib/components/AppSidebar.svelte` / `src/routes/+layout.svelte` | ベルと未読バッジ、パンくず |
| `src/routes/projects/[key]/issues/[number=int]/` | 表示時の既読化、コメントのアンカー、メンション補完 |
| `src/routes/projects/[key]/settings/` | 「外部連携」セクション |
| `src/lib/caret.ts`（新規） | textarea のキャレット座標（ミラー要素方式） |
| `src/lib/components/MentionMenu.svelte`（新規） | `@` 補完のポップオーバー |
| `src/lib/components/MarkdownEditor.svelte` / `src/routes/projects/[key]/issues/new/` | 起票画面でのメンション補完 |
| `e2e/main-flow.spec.ts` | 通知・メンション・Webhook 設定の E2E |
| `apps/docs/...` | 機能一覧・Slack 連携ページ・権限表 |

---

### Task 1: メンションの記法・抽出・描画

**Files:**
- Create: `src/lib/mentions.ts`
- Create: `src/lib/mentions.test.ts`
- Modify: `src/lib/server/markdown.ts`
- Modify: `src/lib/server/markdown.test.ts`
- Modify: `src/routes/layout.css`（`.markdown` ブロックの近く）

**Interfaces:**
- Produces:
  - `interface MentionCandidate { id: string; name: string }`
  - `MENTION_SOURCE: string`（キャプチャ 1 = 表示名、2 = userId）
  - `mentionToken(c: MentionCandidate): string`
  - `extractMentionIds(text: string): string[]`（重複なし、コード内は除外）
  - `mentionsToPlain(text: string): string`（記法 → `@表示名`）
  - `findMentionQuery(value: string, caret: number): { start: number; query: string } | null`
  - `filterCandidates(cands: MentionCandidate[], query: string, limit?: number): MentionCandidate[]`

- [ ] **Step 1: Write the failing test**

`src/lib/mentions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	extractMentionIds,
	filterCandidates,
	findMentionQuery,
	mentionToken,
	mentionsToPlain
} from './mentions';

const A = '0192f0c1-0000-7000-8000-000000000001';
const B = '0192f0c1-0000-7000-8000-000000000002';

describe('mentionToken', () => {
	it('表示名と ID からトークンを作る', () => {
		expect(mentionToken({ id: A, name: '田中 太郎' })).toBe(`@[田中 太郎](user:${A})`);
	});
	it('表示名の ] と改行は除く', () => {
		expect(mentionToken({ id: A, name: 'a]b\nc' })).toBe(`@[abc](user:${A})`);
	});
	it('除いた結果が空なら ? にする', () => {
		expect(mentionToken({ id: A, name: ']' })).toBe(`@[?](user:${A})`);
	});
});

describe('extractMentionIds', () => {
	it('重複を除いて ID を取り出す', () => {
		const t = `${mentionToken({ id: A, name: 'a' })} と ${mentionToken({ id: B, name: 'b' })} と ${mentionToken({ id: A, name: 'a' })}`;
		expect(extractMentionIds(t)).toEqual([A, B]);
	});
	it('UUID でない ID は無視する', () => {
		expect(extractMentionIds('@[a](user:abc)')).toEqual([]);
	});
	it('インラインコードとコードブロックの中は無視する', () => {
		const tok = mentionToken({ id: A, name: 'a' });
		expect(extractMentionIds('`' + tok + '`')).toEqual([]);
		expect(extractMentionIds('```\n' + tok + '\n```')).toEqual([]);
		expect(extractMentionIds('```\n' + tok + '\n```\n' + mentionToken({ id: B, name: 'b' }))).toEqual([B]);
	});
	it('トークンから作った ID はそのまま取り出せる（表示名に ] を含む人）', () => {
		expect(extractMentionIds(mentionToken({ id: A, name: 'x]y' }))).toEqual([A]);
	});
});

describe('mentionsToPlain', () => {
	it('記法を @表示名 にする', () => {
		expect(mentionsToPlain(`hi ${mentionToken({ id: A, name: '田中' })}!`)).toBe('hi @田中!');
	});
});

describe('findMentionQuery', () => {
	it('行頭・空白直後の @ からキャレットまでを返す', () => {
		expect(findMentionQuery('@ta', 3)).toEqual({ start: 0, query: 'ta' });
		expect(findMentionQuery('hello @田', 8)).toEqual({ start: 6, query: '田' });
		expect(findMentionQuery('a\n@', 3)).toEqual({ start: 2, query: '' });
	});
	it('メールアドレスや空白を挟んだ場合は null', () => {
		expect(findMentionQuery('mail@ex', 7)).toBeNull();
		expect(findMentionQuery('@ta ro', 6)).toBeNull();
		expect(findMentionQuery('abc', 3)).toBeNull();
	});
});

describe('filterCandidates', () => {
	const cands = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `User${i}` }));
	it('大文字小文字を無視して部分一致し、最大 8 件', () => {
		expect(filterCandidates(cands, 'user')).toHaveLength(8);
		expect(filterCandidates(cands, 'R3').map((c) => c.id)).toEqual(['3']);
		expect(filterCandidates([{ id: 'x', name: '顧客 太郎' }], '太郎')).toHaveLength(1);
	});
});
```

`src/lib/server/markdown.test.ts` の `describe` 内に追加:

```ts
	it('メンションはバッジにし、リンクにしない', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		const html = renderMarkdown(`hi @[田中 太郎](user:${id}) さん`);
		expect(html).toContain('<span class="mention">@田中 太郎</span>');
		expect(html).not.toContain('user:');
	});
	it('メンションの表示名はエスケープする', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(renderMarkdown(`@[<b>x</b>](user:${id})`)).toContain('@&lt;b&gt;x&lt;/b&gt;');
	});
	it('コード内のメンション記法はそのまま表示する', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(renderMarkdown('`@[a](user:' + id + ')`')).not.toContain('class="mention"');
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/mentions.test.ts src/lib/server/markdown.test.ts`
Expected: FAIL（`./mentions` が無い、メンションが `<a href="user:...">` になる）

- [ ] **Step 3: Write minimal implementation**

`src/lib/mentions.ts`:

```ts
export interface MentionCandidate {
	id: string;
	name: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `@[表示名](user:<uuid>)`。キャプチャ 1 = 表示名、2 = userId */
export const MENTION_SOURCE = `@\\[([^\\]\\n]{1,100})\\]\\(user:(${UUID})\\)`;
const mentionRe = () => new RegExp(MENTION_SOURCE, 'g');

export function mentionToken(c: MentionCandidate): string {
	const name = c.name.replace(/[\]\n\r]/g, '').slice(0, 100) || '?';
	return `@[${name}](user:${c.id})`;
}

/** コードブロック（```）とインラインコード（`）を取り除く。描画と同じくコード内はメンションにしない */
function stripCode(text: string): string {
	return text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractMentionIds(text: string): string[] {
	return [...new Set(Array.from(stripCode(text).matchAll(mentionRe()), (m) => m[2]))];
}

export function mentionsToPlain(text: string): string {
	return text.replace(mentionRe(), (_, name: string) => `@${name}`);
}

/** キャレット直前の `@xxx` を探す。`@` は行頭か空白の直後で、xxx に空白は含まない */
export function findMentionQuery(
	value: string,
	caret: number
): { start: number; query: string } | null {
	const m = value.slice(0, caret).match(/(?:^|\s)@([^\s@[\]()]{0,30})$/);
	if (!m) return null;
	return { start: caret - m[1].length - 1, query: m[1] };
}

export function filterCandidates(
	cands: MentionCandidate[],
	query: string,
	limit = 8
): MentionCandidate[] {
	const q = query.toLowerCase();
	return cands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, limit);
}
```

`src/lib/server/markdown.ts` の `renderMarkdown` の前に追加（import も追加）:

```ts
import { MENTION_SOURCE } from '$lib/mentions';

const mentionAt = new RegExp(`^${MENTION_SOURCE}`);

// '@' は markdown-it の text ルールの区切り文字なので、文中の '@' でもこのルールに届く
md.inline.ruler.before('link', 'mention', (state, silent) => {
	if (state.src.charCodeAt(state.pos) !== 0x40 /* @ */) return false;
	const m = mentionAt.exec(state.src.slice(state.pos));
	if (!m) return false;
	if (!silent) state.push('mention', '', 0).content = m[1];
	state.pos += m[0].length;
	return true;
});

md.renderer.rules.mention = (tokens, idx) =>
	`<span class="mention">@${md.utils.escapeHtml(tokens[idx].content)}</span>`;
```

`src/routes/layout.css` の `.markdown a { ... }` の後に追加:

```css
	.markdown .mention {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--ring-soft);
		color: var(--primary);
		font-weight: 500;
		white-space: nowrap;
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit --run src/lib/mentions.test.ts src/lib/server/markdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentions.ts src/lib/mentions.test.ts src/lib/server/markdown.ts src/lib/server/markdown.test.ts src/routes/layout.css
git commit -m "feat(web): mention syntax, extraction and badge rendering"
```

---

### Task 2: テーブル・権限・コンテキスト

**Files:**
- Modify: `src/lib/server/db/schema.ts`（`attachment` の後）
- Create: `drizzle/<timestamp>_notifications/`（生成）
- Modify: `src/lib/server/authz.ts`, `src/lib/server/authz.test.ts`
- Modify: `src/lib/server/context.ts`, `src/hooks.server.ts`, `src/lib/server/test-utils.ts`
- Test: `src/lib/server/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `notification`, `projectWebhook` テーブル
  - `NOTIFICATION_TYPES`, `type NotificationType`, `WEBHOOK_PROVIDERS`, `type WebhookProviderId`（schema.ts から export）
  - `Action` に `'webhook:manage'`
  - `BaseContext.fetch: typeof fetch`
  - `createTestBase()` の戻り値に `fetched: { url: string; body: unknown }[]` と `pending: Promise<unknown>[]`。`overrides.fetch` で差し替え可能。

- [ ] **Step 1: Write the failing test**

`src/lib/server/authz.test.ts` の `table` に追加:

```ts
	['webhook:manage', {}, true, false, false],
```

`src/lib/server/db/schema.test.ts` に追加（既存 import に `notification, projectWebhook` と test-utils を足す。ファイル冒頭の既存の import 形式に合わせる）:

```ts
describe('notification / project_webhook', () => {
	it('課題を消すと通知も消え、プロジェクトを消すと Webhook も消える', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const member = await seedUser(db, 'member');
		const p = await seedProject(db, { key: 'ACME', members: [member] });
		await createIssue(ctxOf(base, member), 'ACME', { title: 'A' });
		const [i] = await db.select().from(issue);
		await db.insert(notification).values({
			id: uuidv7(),
			userId: member.id,
			actorId: member.id,
			issueId: i.id,
			type: 'assigned'
		});
		await db.insert(projectWebhook).values({
			id: uuidv7(),
			projectId: p.id,
			provider: 'slack',
			url: 'https://hooks.slack.com/services/T/B/X'
		});
		await db.delete(issue);
		expect(await db.select().from(notification)).toHaveLength(0);
		await db.delete(project);
		expect(await db.select().from(projectWebhook)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/authz.test.ts src/lib/server/db/schema.test.ts`
Expected: FAIL（`webhook:manage` が Action に無い、`notification` が export されていない）

- [ ] **Step 3: Implement**

`schema.ts`（先頭の import に `STATUSES` は既にある）:

```ts
export const NOTIFICATION_TYPES = ['assigned', 'commented', 'status_changed', 'mentioned'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notification = sqliteTable(
	'notification',
	{
		id: text().primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		actorId: text('actor_id')
			.notNull()
			.references(() => user.id),
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		type: text({ enum: NOTIFICATION_TYPES }).notNull(),
		commentId: text('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
		fromStatus: text('from_status', { enum: STATUSES }),
		toStatus: text('to_status', { enum: STATUSES }),
		readAt: integer('read_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		index('notification_user_read_idx').on(t.userId, t.readAt),
		index('notification_user_created_idx').on(t.userId, t.createdAt)
	]
);

export const WEBHOOK_PROVIDERS = ['slack'] as const;
export type WebhookProviderId = (typeof WEBHOOK_PROVIDERS)[number];

export const projectWebhook = sqliteTable(
	'project_webhook',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		provider: text({ enum: WEBHOOK_PROVIDERS }).notNull(),
		url: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [index('project_webhook_project_idx').on(t.projectId)]
);
```

マイグレーション生成: `pnpm db:generate --name notifications`。生成された `drizzle/<ts>_notifications/migration.sql` に `CREATE TABLE notification` と `CREATE TABLE project_webhook` とインデックス 3 つだけが含まれることを確認する（既存テーブルの変更が混ざっていたら止めて報告）。

`authz.ts`: `Action` に `| 'webhook:manage'` を足し、`can` の `case 'user:manage': case 'project:manage':` に `case 'webhook:manage':` を並べる（`return false`）。

`context.ts` の `BaseContext` に追加:

```ts
	/** 外部 HTTP 呼び出し（Webhook）。テストで差し替える */
	fetch: typeof fetch;
```

`hooks.server.ts` の `event.locals.base` に追加:

```ts
		// Workers の fetch は this が違うと Illegal invocation になるので包む
		fetch: (input, init) => fetch(input, init),
```

`test-utils.ts` の `createTestBase` を次のように変える:

```ts
export function createTestBase(
	db: DB,
	overrides: Partial<BaseContext> = {}
): BaseContext & {
	sent: MailMessage[];
	fetched: { url: string; body: unknown }[];
	pending: Promise<unknown>[];
} {
	const sent: MailMessage[] = [];
	const fetched: { url: string; body: unknown }[] = [];
	const pending: Promise<unknown>[] = [];
	return {
		db,
		mailer: {
			send: async (m) => {
				sent.push(m);
			}
		},
		bucket: createMemoryStore(),
		waitUntil: (p) => {
			pending.push(p);
		},
		fetch: async (input, init) => {
			fetched.push({ url: String(input), body: JSON.parse(String(init?.body ?? 'null')) });
			return new Response('ok', { status: 200 });
		},
		baseUrl: 'http://localhost:5173',
		hashPassword: async (pw) => `test-hash:${pw}`,
		sent,
		fetched,
		pending,
		...overrides
	};
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit --run && pnpm check`
Expected: 全テスト PASS、型エラーなし

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts src/lib/server/db/schema.test.ts drizzle src/lib/server/authz.ts src/lib/server/authz.test.ts src/lib/server/context.ts src/hooks.server.ts src/lib/server/test-utils.ts
git commit -m "feat(web): add notification and project_webhook tables, webhook:manage and ctx.fetch"
```

---

### Task 3: 受信者計算（純粋関数）

**Files:**
- Create: `src/lib/server/notifications/recipients.ts`
- Test: `src/lib/server/notifications/recipients.test.ts`

**Interfaces:**
- Consumes: `NotificationType`（Task 2）、`Status`（`$lib/labels`）
- Produces:
  ```ts
  type Change =
    | { kind: 'assigned'; assigneeId: string }
    | { kind: 'status_changed'; from: Status; to: Status }
    | { kind: 'commented'; commentId: string }
    | { kind: 'mentioned'; userIds: string[]; commentId: string | null };
  interface Participants { reporterId: string; assigneeId: string | null; commenterIds: string[] }
  interface PlannedNotification { userId: string; type: NotificationType; commentId: string | null; fromStatus: Status | null; toStatus: Status | null }
  function planNotifications(input: { actorId: string; participants: Participants; changes: Change[]; canReceive: (userId: string) => boolean }): PlannedNotification[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { planNotifications, type Change, type Participants } from './recipients';

const P: Participants = { reporterId: 'r', assigneeId: 'a', commenterIds: ['c1', 'c2'] };
const all = () => true;
const plan = (changes: Change[], opts: Partial<{ actorId: string; participants: Participants; canReceive: (id: string) => boolean }> = {}) =>
	planNotifications({ actorId: 'x', participants: P, canReceive: all, changes, ...opts })
		.map((n) => `${n.userId}:${n.type}`)
		.sort();

describe('planNotifications', () => {
	it('担当者の設定は新しい担当者だけに assigned', () => {
		expect(plan([{ kind: 'assigned', assigneeId: 'a' }])).toEqual(['a:assigned']);
	});
	it('コメントは関係者全員（起票者・担当者・コメントした人）に commented', () => {
		expect(plan([{ kind: 'commented', commentId: 'k' }])).toEqual([
			'a:commented',
			'c1:commented',
			'c2:commented',
			'r:commented'
		]);
	});
	it('ステータス変更は関係者全員に status_changed（from/to 付き）', () => {
		const out = planNotifications({
			actorId: 'x',
			participants: P,
			canReceive: all,
			changes: [{ kind: 'status_changed', from: 'todo', to: 'done' }]
		});
		expect(out).toHaveLength(4);
		expect(out[0]).toMatchObject({ type: 'status_changed', fromStatus: 'todo', toStatus: 'done', commentId: null });
	});
	it('操作した本人には送らない', () => {
		expect(plan([{ kind: 'commented', commentId: 'k' }], { actorId: 'c1' })).not.toContain('c1:commented');
		expect(plan([{ kind: 'assigned', assigneeId: 'x' }])).toEqual([]);
	});
	it('受信できない人（無効化・非参加）には送らない', () => {
		expect(plan([{ kind: 'commented', commentId: 'k' }], { canReceive: (id) => id !== 'r' })).not.toContain('r:commented');
	});
	it('1 人 1 件。assigned > mentioned > commented / status_changed', () => {
		expect(
			plan([
				{ kind: 'assigned', assigneeId: 'a' },
				{ kind: 'status_changed', from: 'todo', to: 'in_progress' }
			])
		).toEqual(['a:assigned', 'c1:status_changed', 'c2:status_changed', 'r:status_changed']);
		expect(
			plan([
				{ kind: 'commented', commentId: 'k' },
				{ kind: 'mentioned', userIds: ['r', 'm'], commentId: 'k' }
			])
		).toEqual(['a:commented', 'c1:commented', 'c2:commented', 'm:mentioned', 'r:mentioned']);
	});
	it('mentioned はコメント ID を引き継ぐ。説明のメンションは null', () => {
		const [n] = planNotifications({
			actorId: 'x',
			participants: P,
			canReceive: all,
			changes: [{ kind: 'mentioned', userIds: ['m'], commentId: null }]
		});
		expect(n).toMatchObject({ userId: 'm', type: 'mentioned', commentId: null });
	});
	it('担当者なし・コメントなしでも動く', () => {
		expect(
			plan([{ kind: 'commented', commentId: 'k' }], {
				participants: { reporterId: 'r', assigneeId: null, commenterIds: [] }
			})
		).toEqual(['r:commented']);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/notifications/recipients.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: Implement**

```ts
import type { Status } from '$lib/labels';
import type { NotificationType } from '../db/schema';

export type Change =
	| { kind: 'assigned'; assigneeId: string }
	| { kind: 'status_changed'; from: Status; to: Status }
	| { kind: 'commented'; commentId: string }
	| { kind: 'mentioned'; userIds: string[]; commentId: string | null };

/** 更新後の課題の関係者 */
export interface Participants {
	reporterId: string;
	assigneeId: string | null;
	commenterIds: string[];
}

export interface PlannedNotification {
	userId: string;
	type: NotificationType;
	commentId: string | null;
	fromStatus: Status | null;
	toStatus: Status | null;
}

const PRIORITY: Record<NotificationType, number> = {
	assigned: 3,
	mentioned: 2,
	commented: 1,
	status_changed: 1
};

/** 1 操作ぶんの変更から、受信者ごとに最も優先度の高い通知を 1 件ずつ決める */
export function planNotifications(input: {
	actorId: string;
	participants: Participants;
	changes: Change[];
	canReceive: (userId: string) => boolean;
}): PlannedNotification[] {
	const { actorId, participants: p, changes, canReceive } = input;
	const involved = [
		...new Set([p.reporterId, p.assigneeId, ...p.commenterIds].filter((id): id is string => !!id))
	];
	const best = new Map<string, PlannedNotification>();
	const offer = (userId: string, n: Omit<PlannedNotification, 'userId'>) => {
		if (userId === actorId || !canReceive(userId)) return;
		const cur = best.get(userId);
		if (!cur || PRIORITY[n.type] > PRIORITY[cur.type]) best.set(userId, { userId, ...n });
	};
	const none = { commentId: null, fromStatus: null, toStatus: null };
	for (const c of changes) {
		switch (c.kind) {
			case 'assigned':
				offer(c.assigneeId, { ...none, type: 'assigned' });
				break;
			case 'status_changed':
				for (const u of involved)
					offer(u, { ...none, type: 'status_changed', fromStatus: c.from, toStatus: c.to });
				break;
			case 'commented':
				for (const u of involved) offer(u, { ...none, type: 'commented', commentId: c.commentId });
				break;
			case 'mentioned':
				for (const u of c.userIds) offer(u, { ...none, type: 'mentioned', commentId: c.commentId });
				break;
		}
	}
	return [...best.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit --run src/lib/server/notifications/recipients.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/notifications/recipients.ts src/lib/server/notifications/recipients.test.ts
git commit -m "feat(web): compute notification recipients"
```

---

### Task 4: `notify()`（アプリ内通知）

**Files:**
- Create: `src/lib/server/notifications/events.ts`
- Create: `src/lib/server/notifications/index.ts`
- Test: `src/lib/server/notifications/notify.test.ts`

**Interfaces:**
- Consumes: `planNotifications`, `Change`（Task 3）、`extractMentionIds`（Task 1）、`listAssignableUsers(db, projectId)`（既存 `services/projects.ts`。無効化を除いた admin + 参加者を `{ id, name, role }[]` で返す）
- Produces:
  ```ts
  type IssueEvent =
    | { kind: 'issue_created'; assigneeId: string | null; priority: Priority; description: string }
    | { kind: 'assignee_changed'; assigneeId: string | null }
    | { kind: 'status_changed'; from: Status; to: Status }
    | { kind: 'commented'; commentId: string; body: string }
    | { kind: 'mentions_added'; commentId: string | null; before: string; after: string };
  interface NotifyInput { project: { id: string; key: string; name: string }; issue: { id: string; number: number; title: string }; events: IssueEvent[] }
  function notify(ctx: AppContext, input: NotifyInput): Promise<void> // 例外を投げない
  ```
  Task 6 で `notify` の中に Webhook 送信を足す。そのため事実の読み込みは `loadFacts()` にまとめておく。

- [ ] **Step 1: Write the failing test**

`notify.test.ts`（services からの呼び出しは Task 5 で配線するので、ここでは `notify` を直接呼ぶ）:

```ts
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { comment, issue, notification, user } from '../db/schema';
import { createIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { notify, type NotifyInput } from '.';

describe('notify (in-app)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	let input: Omit<NotifyInput, 'events'>;
	const as = (a: Actor) => ctxOf(base, a);
	const rows = () =>
		db.select({ userId: notification.userId, type: notification.type }).from(notification);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(guest), 'ACME', { title: 'A' });
		const [i] = await db.select().from(issue);
		input = { project: { id: p.id, key: 'ACME', name: 'Acme' }, issue: { id: i.id, number: 1, title: 'A' } };
	});
	afterEach(() => vi.restoreAllMocks());

	it('担当者の変更で新しい担当者に assigned', async () => {
		await db.update(issue).set({ assigneeId: member.id });
		await notify(as(admin), { ...input, events: [{ kind: 'assignee_changed', assigneeId: member.id }] });
		expect(await rows()).toEqual([{ userId: member.id, type: 'assigned' }]);
	});

	it('担当を外したときは作らない', async () => {
		await notify(as(admin), { ...input, events: [{ kind: 'assignee_changed', assigneeId: null }] });
		expect(await rows()).toEqual([]);
	});

	it('コメントは関係者（起票者・コメントした人）に commented、本文のメンションは mentioned', async () => {
		await db.insert(comment).values({ id: 'c0', issueId: input.issue.id, authorId: admin.id, body: 'x' });
		const body = `${mentionToken(member)} 見てください`;
		await db.insert(comment).values({ id: 'c1', issueId: input.issue.id, authorId: admin.id, body });
		await notify(as(admin), { ...input, events: [{ kind: 'commented', commentId: 'c1', body }] });
		const got = (await rows()).map((r) => `${r.userId === guest.id ? 'guest' : 'member'}:${r.type}`).sort();
		expect(got).toEqual(['guest:commented', 'member:mentioned']);
	});

	it('アクセスできない人・無効化された人へのメンションは無視する', async () => {
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, member.id));
		const body = `${mentionToken(outsider)} ${mentionToken(member)}`;
		await notify(as(admin), {
			...input,
			events: [{ kind: 'mentions_added', commentId: null, before: '', after: body }]
		});
		expect(await rows()).toEqual([]);
	});

	it('mentions_added は増えた人だけ', async () => {
		const before = mentionToken(member);
		const after = `${mentionToken(member)} ${mentionToken(admin)}`;
		await notify(as(guest), { ...input, events: [{ kind: 'mentions_added', commentId: null, before, after }] });
		expect(await rows()).toEqual([{ userId: admin.id, type: 'mentioned' }]);
	});

	it('issue_created は担当者に assigned、説明のメンションに mentioned', async () => {
		await notify(as(member), {
			...input,
			events: [
				{ kind: 'issue_created', assigneeId: guest.id, priority: 'none', description: mentionToken(admin) }
			]
		});
		const got = await rows();
		expect(got).toContainEqual({ userId: guest.id, type: 'assigned' });
		expect(got).toContainEqual({ userId: admin.id, type: 'mentioned' });
	});

	it('内部で失敗しても例外を投げずにログする', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = { ...as(admin), db: { select: () => { throw new Error('boom'); } } as unknown as DB };
		await expect(
			notify(broken, { ...input, events: [{ kind: 'assignee_changed', assigneeId: member.id }] })
		).resolves.toBeUndefined();
		expect(err).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/notifications/notify.test.ts`
Expected: FAIL（`.` が無い）

- [ ] **Step 3: Implement**

`events.ts`:

```ts
import type { Priority, Status } from '$lib/labels';

/** services が notify に渡す出来事。ID と本文だけを持ち、名前の解決は notify が行う */
export type IssueEvent =
	| { kind: 'issue_created'; assigneeId: string | null; priority: Priority; description: string }
	| { kind: 'assignee_changed'; assigneeId: string | null }
	| { kind: 'status_changed'; from: Status; to: Status }
	| { kind: 'commented'; commentId: string; body: string }
	/** 説明（commentId = null）またはコメントの編集。before/after の差分で増えたメンションだけ扱う */
	| { kind: 'mentions_added'; commentId: string | null; before: string; after: string };

export interface NotifyInput {
	project: { id: string; key: string; name: string };
	issue: { id: string; number: number; title: string };
	events: IssueEvent[];
}
```

`index.ts`:

```ts
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { extractMentionIds } from '$lib/mentions';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { comment, issue, notification } from '../db/schema';
import { listAssignableUsers } from '../services/projects';
import type { IssueEvent, NotifyInput } from './events';
import { planNotifications, type Change } from './recipients';

export type { IssueEvent, NotifyInput } from './events';

/** イベントでメンションが増えた人（受信可否で絞る前） */
export function addedMentions(e: IssueEvent): string[] {
	switch (e.kind) {
		case 'issue_created':
			return extractMentionIds(e.description);
		case 'commented':
			return extractMentionIds(e.body);
		case 'mentions_added': {
			const before = new Set(extractMentionIds(e.before));
			return extractMentionIds(e.after).filter((id) => !before.has(id));
		}
		default:
			return [];
	}
}

function toChanges(e: IssueEvent): Change[] {
	const mentioned = (commentId: string | null): Change[] => {
		const userIds = addedMentions(e);
		return userIds.length ? [{ kind: 'mentioned', userIds, commentId }] : [];
	};
	switch (e.kind) {
		case 'issue_created':
			return [
				...(e.assigneeId ? [{ kind: 'assigned', assigneeId: e.assigneeId } as const] : []),
				...mentioned(null)
			];
		case 'assignee_changed':
			return e.assigneeId ? [{ kind: 'assigned', assigneeId: e.assigneeId }] : [];
		case 'status_changed':
			return [{ kind: 'status_changed', from: e.from, to: e.to }];
		case 'commented':
			return [{ kind: 'commented', commentId: e.commentId }, ...mentioned(e.commentId)];
		case 'mentions_added':
			return mentioned(e.commentId);
	}
}

/** 受信者計算と Webhook に必要な事実を 1 回の往復（並列）で読む */
async function loadFacts(db: DB, input: NotifyInput) {
	const [[cur], commenters, receivers] = await Promise.all([
		db
			.select({ reporterId: issue.reporterId, assigneeId: issue.assigneeId })
			.from(issue)
			.where(eq(issue.id, input.issue.id)),
		db
			.selectDistinct({ id: comment.authorId })
			.from(comment)
			.where(eq(comment.issueId, input.issue.id)),
		listAssignableUsers(db, input.project.id)
	]);
	return {
		participants: {
			reporterId: cur.reporterId,
			assigneeId: cur.assigneeId,
			commenterIds: commenters.map((c) => c.id)
		},
		/** 通知を受け取れる人（無効化を除く admin + 参加者）。名前の解決にも使う */
		names: new Map(receivers.map((u) => [u.id, u.name]))
	};
}

/** 更新が確定した後に呼ぶ。失敗しても元の操作には影響させない */
export async function notify(ctx: AppContext, input: NotifyInput): Promise<void> {
	try {
		const facts = await loadFacts(ctx.db, input);
		const planned = planNotifications({
			actorId: ctx.actor.id,
			participants: facts.participants,
			changes: input.events.flatMap(toChanges),
			canReceive: (id) => facts.names.has(id)
		});
		if (planned.length > 0) {
			await ctx.db.insert(notification).values(
				planned.map((n) => ({ id: uuidv7(), actorId: ctx.actor.id, issueId: input.issue.id, ...n }))
			);
		}
	} catch (e) {
		console.error('[notify] failed', e);
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit --run src/lib/server/notifications`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/notifications
git commit -m "feat(web): create in-app notifications from issue events"
```

---

### Task 5: services から `notify` を呼ぶ

**Files:**
- Modify: `src/lib/server/services/issues.ts`（`createIssue` / `updateIssue` / `moveIssue`）
- Modify: `src/lib/server/services/comments.ts`（`addComment` / `editComment` / `findOwnedComment`）
- Test: `src/lib/server/notifications/wiring.test.ts`

**Interfaces:**
- Consumes: `notify(ctx, input)`, `IssueEvent`（Task 4）
- Produces: なし（振る舞いのみ）

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue, notification } from '../db/schema';
import { addComment, editComment, listComments } from '../services/comments';
import { createIssue, moveIssue, updateIssue } from '../services/issues';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';

describe('services → notify', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor, other: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const got = async () =>
		(await db.select().from(notification)).map(
			(n) => `${[member, guest, other].find((u) => u.id === n.userId)!.name}:${n.type}`
		).sort();

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member', 'member');
		guest = await seedUser(db, 'guest', 'guest');
		other = await seedUser(db, 'member', 'other');
		await seedProject(db, { key: 'ACME', members: [member, guest, other] });
	});

	it('起票時に担当者を指定すると assigned', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id });
		expect(await got()).toEqual(['guest:assigned']);
	});

	it('担当とステータスを同時に変えると、新担当は assigned、他の関係者は status_changed', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await updateIssue(as(member), 'ACME', 1, { assigneeId: other.id, status: 'in_progress' });
		expect(await got()).toEqual(['guest:status_changed', 'other:assigned']);
	});

	it('タイトルだけの変更では通知しない', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await updateIssue(as(member), 'ACME', 1, { title: 'B' });
		expect(await got()).toEqual([]);
	});

	it('説明の編集で増えたメンションだけ通知する', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', description: mentionToken(guest) });
		expect(await got()).toEqual(['guest:mentioned']);
		await updateIssue(as(member), 'ACME', 1, {
			description: `${mentionToken(guest)} ${mentionToken(other)}`
		});
		expect(await got()).toEqual(['guest:mentioned', 'other:mentioned']);
	});

	it('カンバンで列を移ると status_changed、同じ列の並び替えでは通知しない', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await createIssue(as(guest), 'ACME', { title: 'B' });
		const [a] = await db.select().from(issue);
		await moveIssue(as(member), 'ACME', { issueId: a.id, status: 'todo', beforeId: '', afterId: '' });
		expect(await got()).toEqual([]);
		await moveIssue(as(member), 'ACME', { issueId: a.id, status: 'done' });
		expect(await got()).toEqual(['guest:status_changed']);
	});

	it('コメントで関係者に commented、メンションされた人に mentioned', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await addComment(as(member), 'ACME', 1, { body: `${mentionToken(other)} お願いします` });
		expect(await got()).toEqual(['guest:commented', 'other:mentioned']);
	});

	it('コメントをメンションを変えずに編集しても再通知しない。増やせば増えた分だけ', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await addComment(as(member), 'ACME', 1, { body: mentionToken(other) });
		const [c] = await listComments(as(member), 'ACME', 1);
		await editComment(as(member), 'ACME', 1, c.id, { body: `${mentionToken(other)} 誤字修正` });
		expect(await got()).toEqual(['guest:commented', 'other:mentioned']);
		await editComment(as(member), 'ACME', 1, c.id, {
			body: `${mentionToken(other)} ${mentionToken(guest)}`
		});
		expect(await got()).toEqual(['guest:commented', 'guest:mentioned', 'other:mentioned']);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/notifications/wiring.test.ts`
Expected: FAIL（通知が作られない）

- [ ] **Step 3: Implement**

`issues.ts`（`import { notify, type IssueEvent } from '../notifications';` を追加）:

`createIssue` の末尾を次に置き換える:

```ts
	await linkAttachments(ctx, { projectId: p.id, issueId: id }, data.description);
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const [row] = await ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id));
	await notify(ctx, {
		project: p,
		issue: { id, number: row.number, title: data.title },
		events: [
			{ kind: 'issue_created', assigneeId, priority: data.priority, description: data.description }
		]
	});
	return { number: row.number };
```

`updateIssue` の末尾（`linkAttachments` の後）に追加:

```ts
	const events: IssueEvent[] = [];
	if (patch.assigneeId !== undefined) events.push({ kind: 'assignee_changed', assigneeId: patch.assigneeId });
	if (patch.status !== undefined) events.push({ kind: 'status_changed', from: cur.status, to: patch.status });
	if (patch.description !== undefined) {
		events.push({ kind: 'mentions_added', commentId: null, before: cur.description, after: patch.description });
	}
	if (events.length > 0) {
		await notify(ctx, {
			project: p,
			issue: { id: cur.id, number: cur.number, title: patch.title ?? cur.title },
			events
		});
	}
```

`moveIssue` の最後の `update` の後に追加:

```ts
	if (data.status !== cur.status) {
		await notify(ctx, {
			project: p,
			issue: { id: cur.id, number: cur.number, title: cur.title },
			events: [{ kind: 'status_changed', from: cur.status, to: data.status }]
		});
	}
```

`comments.ts`（`import { notify } from '../notifications';` を追加）:

`addComment` の末尾に追加:

```ts
	await notify(ctx, {
		project,
		issue: { id: issue.id, number: issue.number, title: issue.title },
		events: [{ kind: 'commented', commentId: id, body }]
	});
```

`findOwnedComment` の戻り値を `return { ...c, projectId: project.id, project, issue };` に変え、`editComment` の末尾に追加:

```ts
	await notify(ctx, {
		project: c.project,
		issue: { id: c.issue.id, number: c.issue.number, title: c.issue.title },
		events: [{ kind: 'mentions_added', commentId: c.id, before: c.body, after: body }]
	});
```

注: `notify` は `services/projects.ts` の `listAssignableUsers` を import し、`issues.ts` / `comments.ts` は `notifications` を import する。`projects.ts` は `notifications` を import しないので循環しない。

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit --run src/lib/server`
Expected: PASS（既存の issues / comments テストも通る）

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/services/issues.ts src/lib/server/services/comments.ts src/lib/server/notifications/wiring.test.ts
git commit -m "feat(web): notify on assignment, status change, comments and mentions"
```

---

### Task 6: Webhook（Slack）の組み立てと送信

**Files:**
- Create: `src/lib/server/notifications/format.ts`
- Create: `src/lib/server/notifications/webhooks/types.ts`
- Create: `src/lib/server/notifications/webhooks/slack.ts`
- Create: `src/lib/server/notifications/webhooks/index.ts`
- Modify: `src/lib/server/notifications/events.ts`（`WebhookEvent` を追加）
- Modify: `src/lib/server/notifications/index.ts`（`loadFacts` に Webhook 取得、`notify` に送信）
- Test: `src/lib/server/notifications/format.test.ts`, `src/lib/server/notifications/webhooks/slack.test.ts`, `src/lib/server/notifications/webhooks/deliver.test.ts`, `src/lib/server/notifications/notify.test.ts`（追記）

**Interfaces:**
- Consumes: `NotifyInput`, `addedMentions`（Task 4）、`mentionsToPlain`（Task 1）、`projectWebhook`, `WebhookProviderId`（Task 2）、`STATUS_LABEL`, `PRIORITY_LABEL`（`$lib/labels`）
- Produces:
  ```ts
  // format.ts
  function excerpt(markdown: string, max: number): string
  // events.ts
  interface WebhookEvent {
    project: { key: string; name: string };
    issue: { number: number; title: string; url: string };
    actor: { name: string };
    detail:
      | { kind: 'issue_created'; assignee: string | null; priority: Priority }
      | { kind: 'assignee_changed'; assignee: string | null }
      | { kind: 'status_changed'; from: Status; to: Status }
      | { kind: 'commented'; excerpt: string }
      | { kind: 'mentions_added'; where: 'comment' | 'description'; mentioned: string[] };
  }
  // webhooks/types.ts
  interface WebhookProvider { id: WebhookProviderId; label: string; urlPattern: RegExp; build(e: WebhookEvent): unknown | null; buildTest(project: { key: string; name: string }): unknown }
  // webhooks/index.ts
  const providers: Record<WebhookProviderId, WebhookProvider>
  function deliver(fetchFn: typeof fetch, url: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> // 例外を投げない
  ```

- [ ] **Step 1: Write the failing tests**

`format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mentionToken } from '$lib/mentions';
import { excerpt } from './format';

describe('excerpt', () => {
	it('Markdown 記号を除き、空白を詰める', () => {
		expect(excerpt('# 見出し\n\n- **太字** と `code`\n> 引用 [リンク](https://x)', 200)).toBe(
			'見出し 太字 と code 引用 リンク'
		);
	});
	it('画像は alt、メンションは @名前 にする', () => {
		const id = '0192f0c1-0000-7000-8000-000000000001';
		expect(excerpt(`![画面](/a.png) ${mentionToken({ id, name: '田中' })}`, 200)).toBe('画面 @田中');
	});
	it('max 文字を超えたら切って … を付ける（サロゲートペアを壊さない）', () => {
		expect(excerpt('あいうえお', 3)).toBe('あいう…');
		expect(excerpt('😀😀😀', 2)).toBe('😀😀…');
		expect(excerpt('abc', 3)).toBe('abc');
	});
});
```

`webhooks/slack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { WebhookEvent } from '../events';
import { slack } from './slack';

const base: Omit<WebhookEvent, 'detail'> = {
	project: { key: 'ACME', name: 'Acme' },
	issue: { number: 12, title: 'ログイン画面', url: 'http://pm.example/projects/ACME/issues/12' },
	actor: { name: '平野' }
};
const textOf = (body: unknown) => JSON.stringify(body);
type Block = { type: string; text?: { text: string }; elements?: { text: string }[] };
const blocks = (body: unknown) => (body as { blocks: Block[] }).blocks;

describe('slack.build', () => {
	it('作成: 文面・課題リンク・優先度と担当者', () => {
		const body = slack.build({ ...base, detail: { kind: 'issue_created', assignee: '田中', priority: 'high' } });
		expect(body).toMatchSnapshot();
		expect(blocks(body)[0].text!.text).toBe(
			'平野さんが 課題を作成 しました。\n*<http://pm.example/projects/ACME/issues/12|ACME-12 ログイン画面>*'
		);
		expect(blocks(body)[1].elements![0].text).toBe('優先度: 高 ・ 担当者: 田中');
	});
	it('担当の変更と解除', () => {
		const set = slack.build({ ...base, detail: { kind: 'assignee_changed', assignee: '田中' } });
		expect(blocks(set)[0].text!.text).toMatch(/^平野さんが 担当者を田中さんに変更 しました。/);
		expect(blocks(set)).toHaveLength(1);
		const unset = slack.build({ ...base, detail: { kind: 'assignee_changed', assignee: null } });
		expect(blocks(unset)[0].text!.text).toMatch(/^平野さんが 担当者を解除 しました。/);
	});
	it('ステータス: context に 未着手 → 進行中', () => {
		const body = slack.build({ ...base, detail: { kind: 'status_changed', from: 'todo', to: 'in_progress' } });
		expect(blocks(body)[0].text!.text).toMatch(/^平野さんが ステータスを変更 しました。/);
		expect(blocks(body)[1].elements![0].text).toBe('未着手 → 進行中');
	});
	it('コメント: context に抜粋。空なら context なし', () => {
		const body = slack.build({ ...base, detail: { kind: 'commented', excerpt: '確認しました' } });
		expect(blocks(body)[0].text!.text).toMatch(/^平野さんが コメント しました。/);
		expect(blocks(body)[1].elements![0].text).toBe('確認しました');
		expect(blocks(slack.build({ ...base, detail: { kind: 'commented', excerpt: '' } }))).toHaveLength(1);
	});
	it('メンション追加: 名前を さん付けで並べる。0 人なら送らない', () => {
		const body = slack.build({
			...base,
			detail: { kind: 'mentions_added', where: 'comment', mentioned: ['田中', '佐藤'] }
		});
		expect(blocks(body)[0].text!.text).toMatch(/^平野さんが 田中さん、佐藤さんを メンション しました。/);
		expect(blocks(body)[1].elements![0].text).toBe('コメント');
		expect(
			slack.build({ ...base, detail: { kind: 'mentions_added', where: 'description', mentioned: [] } })
		).toBeNull();
	});
	it('ユーザー入力の & < > をエスケープし、<!channel> や <@U1> を効かせない', () => {
		const body = slack.build({
			...base,
			actor: { name: '<@U1>' },
			issue: { ...base.issue, title: '<!channel> A&B' },
			detail: { kind: 'commented', excerpt: '<!here>' }
		});
		const s = textOf(body);
		expect(s).not.toContain('<!channel>');
		expect(s).not.toContain('<!here>');
		expect(s).not.toContain('<@U1>');
		expect(s).toContain('&lt;!channel&gt; A&amp;B');
	});
	it('通知欄用の text を持つ', () => {
		const body = slack.build({ ...base, detail: { kind: 'commented', excerpt: 'x' } }) as { text: string };
		expect(body.text).toBe('平野さんが コメント しました。 ACME-12 ログイン画面');
	});
	it('URL パターン', () => {
		expect(slack.urlPattern.test('https://hooks.slack.com/services/T0/B0/abc_DEF-1')).toBe(true);
		expect(slack.urlPattern.test('http://hooks.slack.com/services/T0/B0/x')).toBe(false);
		expect(slack.urlPattern.test('https://hooks.slack.com.evil.example/services/x')).toBe(false);
		expect(slack.urlPattern.test('https://example.com/services/x')).toBe(false);
	});
});
```

`webhooks/deliver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deliver } from '.';

describe('deliver', () => {
	it('JSON を POST し、2xx なら ok', async () => {
		const calls: RequestInit[] = [];
		const f: typeof fetch = async (_u, init) => {
			calls.push(init!);
			return new Response('ok');
		};
		expect(await deliver(f, 'https://x', { a: 1 })).toEqual({ ok: true });
		expect(calls[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
		expect(calls[0].signal).toBeInstanceOf(AbortSignal);
	});
	it('2xx 以外・タイムアウト・ネットワークエラーは例外にせず結果で返す', async () => {
		expect(await deliver(async () => new Response('no', { status: 404 }), 'https://x', {})).toEqual({
			ok: false,
			error: 'HTTP 404'
		});
		const timeout: typeof fetch = async () => {
			throw new DOMException('timed out', 'TimeoutError');
		};
		expect(await deliver(timeout, 'https://x', {})).toEqual({ ok: false, error: 'タイムアウト' });
		const down: typeof fetch = async () => {
			throw new TypeError('fetch failed');
		};
		expect(await deliver(down, 'https://x', {})).toEqual({ ok: false, error: 'fetch failed' });
	});
});
```

`notify.test.ts` に追加（import に `projectWebhook` と `uuidv7` を足す）:

```ts
describe('notify (webhook)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor;
	let input: Omit<NotifyInput, 'events'>;
	const as = (a: Actor) => ctxOf(base, a);
	const posted = async () => {
		await Promise.all(base.pending);
		return base.fetched.map((f) => (f.body as { text: string }).text);
	};

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		const p = await seedProject(db, { key: 'ACME', members: [member, guest] });
		await db.insert(projectWebhook).values({
			id: uuidv7(),
			projectId: p.id,
			provider: 'slack',
			url: 'https://hooks.slack.com/services/T/B/X'
		});
		await createIssue(as(guest), 'ACME', { title: 'A' }); // issue_created が 1 件投稿される
		await Promise.all(base.pending);
		base.fetched.length = 0;
		base.pending.length = 0;
		const [i] = await db.select().from(issue);
		input = { project: { id: p.id, key: 'ACME', name: 'Acme' }, issue: { id: i.id, number: 1, title: 'A' } };
	});

	it('出来事ごとに登録先へ順に投稿する', async () => {
		await notify(as(member), {
			...input,
			events: [
				{ kind: 'assignee_changed', assigneeId: guest.id },
				{ kind: 'status_changed', from: 'todo', to: 'done' }
			]
		});
		expect(await posted()).toEqual([
			'花子さんが 担当者を太郎さんに変更 しました。 ACME-1 A',
			'花子さんが ステータスを変更 しました。 ACME-1 A'
		]);
		expect(base.fetched[0].url).toBe('https://hooks.slack.com/services/T/B/X');
	});

	it('メンション追加は、増えた・受信できる・本人以外の人だけを並べ、いなければ投稿しない', async () => {
		await notify(as(member), {
			...input,
			events: [
				{ kind: 'mentions_added', commentId: null, before: '', after: `${mentionToken(guest)} ${mentionToken(member)}` }
			]
		});
		expect(await posted()).toEqual(['花子さんが 太郎さんを メンション しました。 ACME-1 A']);
		base.fetched.length = 0;
		await notify(as(member), {
			...input,
			events: [{ kind: 'mentions_added', commentId: null, before: mentionToken(guest), after: `${mentionToken(guest)} 誤字修正` }]
		});
		expect(await posted()).toEqual([]);
	});

	it('Webhook がなければ fetch しない', async () => {
		await db.delete(projectWebhook);
		await notify(as(member), { ...input, events: [{ kind: 'status_changed', from: 'todo', to: 'done' }] });
		expect(await posted()).toEqual([]);
	});

	it('送信に失敗してもログだけ', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		base.fetch = async () => new Response('no', { status: 500 });
		await notify(as(member), { ...input, events: [{ kind: 'status_changed', from: 'todo', to: 'done' }] });
		await Promise.all(base.pending);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit --run src/lib/server/notifications`
Expected: FAIL（`format` / `webhooks` が無い、投稿されない）

- [ ] **Step 3: Implement**

`format.ts`:

```ts
import { mentionsToPlain } from '$lib/mentions';

/** 通知・Webhook 用に Markdown をプレーンな 1 行にして max 文字で切る */
export function excerpt(markdown: string, max: number): string {
	const plain = mentionsToPlain(markdown)
		.replace(/```[^\n]*\n?/g, ' ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/gm, '')
		.replace(/(\*\*|__|~~|`)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const chars = Array.from(plain);
	return chars.length > max ? chars.slice(0, max).join('') + '…' : plain;
}
```

`events.ts` に追加:

```ts
/** プロバイダに渡す出来事。名前・URL・抜粋は解決済み */
export interface WebhookEvent {
	project: { key: string; name: string };
	issue: { number: number; title: string; url: string };
	actor: { name: string };
	detail:
		| { kind: 'issue_created'; assignee: string | null; priority: Priority }
		| { kind: 'assignee_changed'; assignee: string | null }
		| { kind: 'status_changed'; from: Status; to: Status }
		| { kind: 'commented'; excerpt: string }
		| { kind: 'mentions_added'; where: 'comment' | 'description'; mentioned: string[] };
}
```

`webhooks/types.ts`:

```ts
import type { WebhookProviderId } from '../../db/schema';
import type { WebhookEvent } from '../events';

/** 外部チャットサービス。新しいサービスはこれを実装してレジストリ（index.ts）に 1 行足す */
export interface WebhookProvider {
	id: WebhookProviderId;
	/** 設定画面の表示名 */
	label: string;
	/** 受け付ける URL。任意の宛先に送らせない（SSRF 対策）ため、サービスのドメインに固定する */
	urlPattern: RegExp;
	/** 送る JSON。null はこのサービスには送らない */
	build(event: WebhookEvent): unknown | null;
	/** 設定画面の「テスト送信」で送る JSON */
	buildTest(project: { key: string; name: string }): unknown;
}
```

`webhooks/slack.ts`:

```ts
import { PRIORITY_LABEL, STATUS_LABEL } from '$lib/labels';
import type { WebhookEvent } from '../events';
import type { WebhookProvider } from './types';

/** Slack の mrkdwn で制御文字になる & < > をエスケープする（<!channel> などを無効にする） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function headline(e: WebhookEvent): string {
	const who = `${e.actor.name}さんが`;
	const d = e.detail;
	switch (d.kind) {
		case 'issue_created':
			return `${who} 課題を作成 しました。`;
		case 'assignee_changed':
			return d.assignee
				? `${who} 担当者を${d.assignee}さんに変更 しました。`
				: `${who} 担当者を解除 しました。`;
		case 'status_changed':
			return `${who} ステータスを変更 しました。`;
		case 'commented':
			return `${who} コメント しました。`;
		case 'mentions_added':
			return `${who} ${d.mentioned.map((n) => `${n}さん`).join('、')}を メンション しました。`;
	}
}

function context(e: WebhookEvent): string {
	const d = e.detail;
	switch (d.kind) {
		case 'issue_created':
			return `優先度: ${PRIORITY_LABEL[d.priority]} ・ 担当者: ${d.assignee ?? '未設定'}`;
		case 'assignee_changed':
			return '';
		case 'status_changed':
			return `${STATUS_LABEL[d.from]} → ${STATUS_LABEL[d.to]}`;
		case 'commented':
			return d.excerpt;
		case 'mentions_added':
			return d.where === 'comment' ? 'コメント' : '説明';
	}
}

function message(head: string, link: string | null, ctx: string) {
	const ref = link ? `\n${link}` : '';
	return {
		blocks: [
			{ type: 'section', text: { type: 'mrkdwn', text: `${esc(head)}${ref}` } },
			...(ctx ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: esc(ctx) }] }] : [])
		]
	};
}

export const slack: WebhookProvider = {
	id: 'slack',
	label: 'Slack',
	urlPattern: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/,
	build(e) {
		if (e.detail.kind === 'mentions_added' && e.detail.mentioned.length === 0) return null;
		const head = headline(e);
		const ref = `${e.project.key}-${e.issue.number} ${e.issue.title}`;
		return {
			text: esc(`${head} ${ref}`),
			...message(head, `*<${e.issue.url}|${esc(ref)}>*`, context(e))
		};
	},
	buildTest(project) {
		const head = `プロジェクト「${project.name}」の通知がこのチャンネルに届きます（テスト送信）`;
		return { text: esc(head), ...message(head, null, '') };
	}
};
```

`webhooks/index.ts`:

```ts
import type { WebhookProviderId } from '../../db/schema';
import { slack } from './slack';
import type { WebhookProvider } from './types';

export type { WebhookProvider } from './types';

export const providers: Record<WebhookProviderId, WebhookProvider> = { slack };

export type DeliverResult = { ok: true } | { ok: false; error: string };

/** JSON を POST する。5 秒でタイムアウトし、再送しない。例外は投げない */
export async function deliver(fetchFn: typeof fetch, url: string, body: unknown): Promise<DeliverResult> {
	try {
		const res = await fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(5000)
		});
		return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError') return { ok: false, error: 'タイムアウト' };
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
```

`notifications/index.ts` の変更:

- import に `projectWebhook`（schema）、`excerpt`（`./format`）、`providers, deliver`（`./webhooks`）、`WebhookEvent`（`./events`）を足す。
- `loadFacts` の `Promise.all` に 4 つ目として `db.select({ provider: projectWebhook.provider, url: projectWebhook.url }).from(projectWebhook).where(eq(projectWebhook.projectId, input.project.id))` を足し、戻り値に `hooks` として含める。
- 次の関数を足す:

```ts
function toWebhookEvent(
	ctx: AppContext,
	input: NotifyInput,
	names: Map<string, string>,
	e: IssueEvent
): WebhookEvent {
	const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
	const shared = {
		project: { key: input.project.key, name: input.project.name },
		issue: {
			number: input.issue.number,
			title: input.issue.title,
			url: `${ctx.baseUrl}/projects/${input.project.key}/issues/${input.issue.number}`
		},
		actor: { name: ctx.actor.name }
	};
	switch (e.kind) {
		case 'issue_created':
			return { ...shared, detail: { kind: e.kind, assignee: name(e.assigneeId), priority: e.priority } };
		case 'assignee_changed':
			return { ...shared, detail: { kind: e.kind, assignee: name(e.assigneeId) } };
		case 'status_changed':
			return { ...shared, detail: { kind: e.kind, from: e.from, to: e.to } };
		case 'commented':
			return { ...shared, detail: { kind: e.kind, excerpt: excerpt(e.body, 200) } };
		case 'mentions_added':
			return {
				...shared,
				detail: {
					kind: e.kind,
					where: e.commentId ? 'comment' : 'description',
					// 通知と同じく、受信できる人・本人以外だけを並べる
					mentioned: addedMentions(e)
						.filter((id) => id !== ctx.actor.id && names.has(id))
						.map((id) => names.get(id)!)
				}
			};
	}
}

function sendWebhooks(
	ctx: AppContext,
	input: NotifyInput,
	facts: Awaited<ReturnType<typeof loadFacts>>
): void {
	for (const hook of facts.hooks) {
		const provider = providers[hook.provider];
		const bodies = input.events
			.map((e) => provider.build(toWebhookEvent(ctx, input, facts.names, e)))
			.filter((b) => b !== null);
		if (bodies.length === 0) continue;
		// 同じ送信先には出来事の順に 1 件ずつ送る
		ctx.waitUntil(
			(async () => {
				for (const body of bodies) {
					const r = await deliver(ctx.fetch, hook.url, body);
					if (!r.ok) console.error(`[webhook] ${hook.provider} ${input.project.key}: ${r.error}`);
				}
			})()
		);
	}
}
```

- `notify` の `try` 内、insert の後に `sendWebhooks(ctx, input, facts);` を足す。

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit --run src/lib/server/notifications`
Expected: PASS（スナップショットは初回作成。内容が §Slack 実装の文面と一致することを目視で確認する）

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/notifications
git commit -m "feat(web): post project events to Slack incoming webhooks"
```

---

### Task 7: Webhook の管理（services）

**Files:**
- Create: `src/lib/server/services/webhooks.ts`
- Test: `src/lib/server/services/webhooks.test.ts`

**Interfaces:**
- Consumes: `providers`, `deliver`（Task 6）、`projectWebhook`, `WEBHOOK_PROVIDERS`（Task 2）、`authorize(actor, 'webhook:manage')`、`requireProject`
- Produces:
  ```ts
  interface WebhookView { id: string; provider: WebhookProviderId; providerLabel: string; maskedUrl: string; createdAt: Date }
  function maskUrl(url: string): string
  function listWebhooks(ctx: AppContext, key: string): Promise<WebhookView[]>
  function addWebhook(ctx: AppContext, key: string, input: unknown): Promise<void> // input: { provider, url }
  function removeWebhook(ctx: AppContext, key: string, id: string): Promise<void>
  function testWebhook(ctx: AppContext, key: string, id: string): Promise<DeliverResult>
  const WEBHOOK_PROVIDER_OPTIONS: { id: WebhookProviderId; label: string }[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addWebhook, listWebhooks, maskUrl, removeWebhook, testWebhook } from './webhooks';

const URL1 = 'https://hooks.slack.com/services/T000/B000/abcdef123456';

describe('webhooks', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'OTHER' });
	});

	it('admin は追加・一覧・削除できる。一覧の URL はマスクする', async () => {
		await addWebhook(as(admin), 'ACME', { provider: 'slack', url: ` ${URL1} ` });
		const [w] = await listWebhooks(as(admin), 'ACME');
		expect(w).toMatchObject({ provider: 'slack', providerLabel: 'Slack', maskedUrl: '••••••••••••123456' });
		expect(JSON.stringify(w)).not.toContain('T000');
		await removeWebhook(as(admin), 'ACME', w.id);
		expect(await listWebhooks(as(admin), 'ACME')).toEqual([]);
	});

	it('admin 以外は一覧も含めて forbidden', async () => {
		for (const a of [member, guest]) {
			await expect(listWebhooks(as(a), 'ACME')).rejects.toMatchObject({ code: 'forbidden' });
			await expect(addWebhook(as(a), 'ACME', { provider: 'slack', url: URL1 })).rejects.toMatchObject({
				code: 'forbidden'
			});
		}
	});

	it('URL の形式が違えば url フィールドの validation', async () => {
		for (const url of ['http://hooks.slack.com/services/x', 'https://example.com/services/x', '']) {
			await expect(addWebhook(as(admin), 'ACME', { provider: 'slack', url })).rejects.toMatchObject({
				code: 'validation',
				fields: { url: [expect.any(String)] }
			});
		}
		await expect(addWebhook(as(admin), 'ACME', { provider: 'discord', url: URL1 })).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('別プロジェクトの Webhook ID は not_found', async () => {
		await addWebhook(as(admin), 'OTHER', { provider: 'slack', url: URL1 });
		const [w] = await listWebhooks(as(admin), 'OTHER');
		await expect(removeWebhook(as(admin), 'ACME', w.id)).rejects.toMatchObject({ code: 'not_found' });
		await expect(testWebhook(as(admin), 'ACME', w.id)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('テスト送信は結果を待って返す', async () => {
		await addWebhook(as(admin), 'ACME', { provider: 'slack', url: URL1 });
		const [w] = await listWebhooks(as(admin), 'ACME');
		expect(await testWebhook(as(admin), 'ACME', w.id)).toEqual({ ok: true });
		expect(base.fetched[0].url).toBe(URL1);
		base.fetch = async () => new Response('no_service', { status: 404 });
		expect(await testWebhook(as(admin), 'ACME', w.id)).toEqual({ ok: false, error: 'HTTP 404' });
	});

	it('maskUrl は末尾 6 文字だけ残す', () => {
		expect(maskUrl('abc')).toBe('••••••••••••abc');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/services/webhooks.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: Implement**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { projectWebhook, WEBHOOK_PROVIDERS, type WebhookProviderId } from '../db/schema';
import { AppError } from '../errors';
import { deliver, providers, type DeliverResult } from '../notifications/webhooks';
import { parse } from '../validation';
import { requireProject } from './projects';

export const WEBHOOK_PROVIDER_OPTIONS = WEBHOOK_PROVIDERS.map((id) => ({
	id,
	label: providers[id].label
}));

export interface WebhookView {
	id: string;
	provider: WebhookProviderId;
	providerLabel: string;
	maskedUrl: string;
	createdAt: Date;
}

/** URL は秘密情報なので末尾 6 文字だけ見せる */
export function maskUrl(url: string): string {
	return '•'.repeat(12) + url.slice(-6);
}

async function managedProject(ctx: AppContext, key: string) {
	authorize(ctx.actor, 'webhook:manage');
	return requireProject(ctx, key);
}

export async function listWebhooks(ctx: AppContext, key: string): Promise<WebhookView[]> {
	const p = await managedProject(ctx, key);
	const rows = await ctx.db
		.select()
		.from(projectWebhook)
		.where(eq(projectWebhook.projectId, p.id))
		.orderBy(asc(projectWebhook.createdAt), asc(projectWebhook.id));
	return rows.map((r) => ({
		id: r.id,
		provider: r.provider,
		providerLabel: providers[r.provider].label,
		maskedUrl: maskUrl(r.url),
		createdAt: r.createdAt
	}));
}

const AddInput = v.object({
	provider: v.picklist(WEBHOOK_PROVIDERS, '連携先を選んでください'),
	url: v.pipe(v.string(), v.trim())
});

export async function addWebhook(ctx: AppContext, key: string, input: unknown): Promise<void> {
	const p = await managedProject(ctx, key);
	const data = parse(AddInput, input);
	const provider = providers[data.provider];
	if (!provider.urlPattern.test(data.url)) {
		const msg = `${provider.label} の Webhook URL を入力してください`;
		throw new AppError('validation', msg, { url: [msg] });
	}
	await ctx.db
		.insert(projectWebhook)
		.values({ id: uuidv7(), projectId: p.id, provider: data.provider, url: data.url });
}

async function findWebhook(ctx: AppContext, key: string, id: string) {
	const p = await managedProject(ctx, key);
	const [row] = await ctx.db
		.select()
		.from(projectWebhook)
		.where(and(eq(projectWebhook.id, id), eq(projectWebhook.projectId, p.id)));
	if (!row) throw new AppError('not_found', '連携先が見つかりません');
	return { project: p, hook: row };
}

export async function removeWebhook(ctx: AppContext, key: string, id: string): Promise<void> {
	const { hook } = await findWebhook(ctx, key, id);
	await ctx.db.delete(projectWebhook).where(eq(projectWebhook.id, hook.id));
}

export async function testWebhook(ctx: AppContext, key: string, id: string): Promise<DeliverResult> {
	const { project, hook } = await findWebhook(ctx, key, id);
	const body = providers[hook.provider].buildTest({ key: project.key, name: project.name });
	return deliver(ctx.fetch, hook.url, body);
}
```

注: `parse` が picklist の失敗を `validation` に変換することを既存の `validation.ts` で確認する（他の services と同じ使い方）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit --run src/lib/server/services/webhooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/services/webhooks.ts src/lib/server/services/webhooks.test.ts
git commit -m "feat(web): manage project webhooks (admin only, masked URLs, test send)"
```

---

### Task 8: 通知の一覧・未読数・既読化（services）

**Files:**
- Create: `src/lib/server/services/notifications.ts`
- Test: `src/lib/server/services/notifications.test.ts`

**Interfaces:**
- Consumes: `notification`（Task 2）、`excerpt`（Task 6）、`STATUS_LABEL`
- Produces:
  ```ts
  interface NotificationItem { id: string; type: NotificationType; summary: string; actorName: string; projectKey: string; issueNumber: number; issueTitle: string; href: string; read: boolean; createdAt: Date }
  function listNotifications(ctx: AppContext, limit?: number): Promise<NotificationItem[]> // 新しい順、既定 50
  function countUnread(ctx: AppContext): Promise<number>
  function markRead(ctx: AppContext, id: string): Promise<{ href: string }>
  function markAllRead(ctx: AppContext): Promise<void>
  function markIssueRead(ctx: AppContext, key: string, number: number): Promise<void>
  ```
  `href` は `/projects/<KEY>/issues/<n>`、コメントに紐づく通知は `#comment-<commentId>` 付き。
  どの関数も「自分宛て」かつ「今アクセスできるプロジェクト（admin は全部、それ以外は `project_member`）」の通知だけを対象にする。

- [ ] **Step 1: Write the failing test**

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken } from '$lib/mentions';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { notification } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, listComments } from './comments';
import { createIssue, updateIssue } from './issues';
import {
	countUnread,
	listNotifications,
	markAllRead,
	markIssueRead,
	markRead
} from './notifications';
import { removeMember } from './projects';

describe('notifications service', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理');
		member = await seedUser(db, 'member', '花子');
		guest = await seedUser(db, 'guest', '太郎');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await createIssue(as(guest), 'ACME', { title: 'ログイン' });
		await updateIssue(as(member), 'ACME', 1, { assigneeId: guest.id, status: 'in_progress' });
		await addComment(as(member), 'ACME', 1, { body: `${mentionToken(guest)} 確認お願いします` });
	});

	it('自分宛てを新しい順に、文面と遷移先付きで返す', async () => {
		const list = await listNotifications(as(guest));
		const [c] = await listComments(as(guest), 'ACME', 1);
		expect(list.map((n) => [n.type, n.summary, n.href])).toEqual([
			['mentioned', 'メンションしました: @太郎 確認お願いします', `/projects/ACME/issues/1#comment-${c.id}`],
			['assigned', '担当者に設定しました', '/projects/ACME/issues/1']
		]);
		expect(list[0]).toMatchObject({ actorName: '花子', projectKey: 'ACME', issueNumber: 1, issueTitle: 'ログイン', read: false });
		expect(await listNotifications(as(member))).toEqual([]);
	});

	it('status_changed と commented と説明のメンションの文面', async () => {
		await updateIssue(as(guest), 'ACME', 1, { status: 'done' });
		await updateIssue(as(guest), 'ACME', 1, { description: mentionToken(member) });
		const summaries = (await listNotifications(as(member))).map((n) => n.summary);
		expect(summaries).toEqual(['説明でメンションしました', '進行中 → 完了']);
		await addComment(as(guest), 'ACME', 1, { body: 'a'.repeat(100) });
		expect((await listNotifications(as(member)))[0].summary).toBe(`コメントしました: ${'a'.repeat(80)}…`);
	});

	it('未読数と既読化', async () => {
		expect(await countUnread(as(guest))).toBe(2);
		const [first] = await listNotifications(as(guest));
		expect(await markRead(as(guest), first.id)).toEqual({ href: first.href });
		expect(await markRead(as(guest), first.id)).toEqual({ href: first.href }); // 2 回目も成功
		expect(await countUnread(as(guest))).toBe(1);
		await markAllRead(as(guest));
		expect(await countUnread(as(guest))).toBe(0);
		expect((await listNotifications(as(guest)))[0].read).toBe(true);
	});

	it('他人の通知は既読化できない（not_found）', async () => {
		const [n] = await db.select().from(notification).where(eq(notification.userId, guest.id));
		await expect(markRead(as(member), n.id)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('課題を開くとその課題の自分宛て未読が既読になる', async () => {
		await markIssueRead(as(guest), 'ACME', 1);
		expect(await countUnread(as(guest))).toBe(0);
	});

	it('プロジェクトから外れた人には、古い通知も見せない', async () => {
		await removeMember(as(admin), 'ACME', guest.id);
		expect(await listNotifications(as(guest))).toEqual([]);
		expect(await countUnread(as(guest))).toBe(0);
		const [n] = await db.select().from(notification).where(eq(notification.userId, guest.id));
		await expect(markRead(as(guest), n.id)).rejects.toMatchObject({ code: 'not_found' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit --run src/lib/server/services/notifications.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: Implement**

```ts
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { STATUS_LABEL } from '$lib/labels';
import type { AppContext } from '../context';
import {
	comment,
	issue,
	notification,
	project,
	projectMember,
	user,
	type NotificationType
} from '../db/schema';
import { AppError } from '../errors';
import { excerpt } from '../notifications/format';
import { getIssue } from './issues';

export interface NotificationItem {
	id: string;
	type: NotificationType;
	summary: string;
	actorName: string;
	projectKey: string;
	issueNumber: number;
	issueTitle: string;
	href: string;
	read: boolean;
	createdAt: Date;
}

/** 自分宛てで、今もアクセスできるプロジェクトの通知 */
function mine(ctx: AppContext): SQL {
	const own = eq(notification.userId, ctx.actor.id);
	if (ctx.actor.role === 'admin') return own;
	return and(
		own,
		inArray(
			notification.issueId,
			ctx.db
				.select({ id: issue.id })
				.from(issue)
				.innerJoin(projectMember, eq(projectMember.projectId, issue.projectId))
				.where(eq(projectMember.userId, ctx.actor.id))
		)
	)!;
}

function summaryOf(r: {
	type: NotificationType;
	commentId: string | null;
	commentBody: string | null;
	fromStatus: keyof typeof STATUS_LABEL | null;
	toStatus: keyof typeof STATUS_LABEL | null;
}): string {
	const body = r.commentBody ? excerpt(r.commentBody, 80) : '';
	switch (r.type) {
		case 'assigned':
			return '担当者に設定しました';
		case 'commented':
			return `コメントしました: ${body}`;
		case 'status_changed':
			return `${STATUS_LABEL[r.fromStatus!]} → ${STATUS_LABEL[r.toStatus!]}`;
		case 'mentioned':
			return r.commentId ? `メンションしました: ${body}` : '説明でメンションしました';
	}
}

const hrefOf = (key: string, n: number, commentId: string | null) =>
	`/projects/${key}/issues/${n}${commentId ? `#comment-${commentId}` : ''}`;

export async function listNotifications(ctx: AppContext, limit = 50): Promise<NotificationItem[]> {
	const rows = await ctx.db
		.select({
			id: notification.id,
			type: notification.type,
			commentId: notification.commentId,
			fromStatus: notification.fromStatus,
			toStatus: notification.toStatus,
			readAt: notification.readAt,
			createdAt: notification.createdAt,
			actorName: user.name,
			projectKey: project.key,
			issueNumber: issue.number,
			issueTitle: issue.title,
			commentBody: comment.body
		})
		.from(notification)
		.innerJoin(user, eq(user.id, notification.actorId))
		.innerJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, eq(project.id, issue.projectId))
		.leftJoin(comment, eq(comment.id, notification.commentId))
		.where(mine(ctx))
		.orderBy(desc(notification.createdAt), desc(notification.id))
		.limit(limit);
	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		summary: summaryOf(r),
		actorName: r.actorName,
		projectKey: r.projectKey,
		issueNumber: r.issueNumber,
		issueTitle: r.issueTitle,
		href: hrefOf(r.projectKey, r.issueNumber, r.commentId),
		read: r.readAt !== null,
		createdAt: r.createdAt
	}));
}

export async function countUnread(ctx: AppContext): Promise<number> {
	const [row] = await ctx.db
		.select({ n: count() })
		.from(notification)
		.where(and(mine(ctx), isNull(notification.readAt)));
	return row?.n ?? 0;
}

/** 既読にして遷移先を返す。既読済みでも成功する */
export async function markRead(ctx: AppContext, id: string): Promise<{ href: string }> {
	const [row] = await ctx.db
		.select({ key: project.key, number: issue.number, commentId: notification.commentId })
		.from(notification)
		.innerJoin(issue, eq(issue.id, notification.issueId))
		.innerJoin(project, eq(project.id, issue.projectId))
		.where(and(eq(notification.id, id), mine(ctx)));
	if (!row) throw new AppError('not_found', '通知が見つかりません');
	await ctx.db
		.update(notification)
		.set({ readAt: sql`coalesce(${notification.readAt}, ${Date.now()})` })
		.where(eq(notification.id, id));
	return { href: hrefOf(row.key, row.number, row.commentId) };
}

export async function markAllRead(ctx: AppContext): Promise<void> {
	await ctx.db
		.update(notification)
		.set({ readAt: new Date() })
		.where(and(eq(notification.userId, ctx.actor.id), isNull(notification.readAt)));
}

/** 課題詳細を開いたときに呼ぶ。課題に参加していなければ not_found（getIssue と同じ） */
export async function markIssueRead(ctx: AppContext, key: string, number: number): Promise<void> {
	const { issue: cur } = await getIssue(ctx, key, number);
	await ctx.db
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.userId, ctx.actor.id),
				eq(notification.issueId, cur.id),
				isNull(notification.readAt)
			)
		);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit --run src/lib/server/services/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/services/notifications.ts src/lib/server/services/notifications.test.ts
git commit -m "feat(web): list, count and mark notifications as read"
```

---

### Task 9: 通知 UI（ベル・通知ページ・課題詳細での既読化）

**Files:**
- Create: `src/lib/notifications.remote.ts`
- Create: `src/routes/notifications/+page.svelte`
- Modify: `src/lib/components/AppSidebar.svelte`
- Modify: `src/routes/+layout.svelte`（パンくず）
- Modify: `src/routes/projects/[key]/issues/[number=int]/issue.remote.ts`
- Modify: `src/routes/projects/[key]/issues/[number=int]/+page.svelte`

**Interfaces:**
- Consumes: `listNotifications`, `countUnread`, `markRead`, `markAllRead`, `markIssueRead`（Task 8）
- Produces（remote functions）:
  - `getUnreadCount = query(() => number)`
  - `getNotifications = query(() => NotificationItem[])`
  - `openNotification = command(v.object({ id: v.string() }), → { href: string })`
  - `readAllNotifications = command(() => void)`
  - `readIssueNotifications = command(IssueRef, → void)`（`issue.remote.ts` 内）

UI は Svelte 5 の作法に従う（`svelte:svelte-file-editor` エージェントか Svelte MCP の autofixer で検証する）。

- [ ] **Step 1: remote functions**

`src/lib/notifications.remote.ts`:

```ts
import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '$lib/server/remote-helpers';
import {
	countUnread,
	listNotifications,
	markAllRead,
	markRead
} from '$lib/server/services/notifications';

export const getUnreadCount = query(() => runQuery(() => countUnread(remoteContext())));

export const getNotifications = query(() => runQuery(() => listNotifications(remoteContext())));

export const openNotification = command(v.object({ id: v.string() }), ({ id }) =>
	runCommand(async () => {
		const res = await markRead(remoteContext(), id);
		void getUnreadCount().refresh();
		void getNotifications().refresh();
		return res;
	})
);

export const readAllNotifications = command(() =>
	runCommand(async () => {
		await markAllRead(remoteContext());
		void getUnreadCount().refresh();
		void getNotifications().refresh();
	})
);
```

`issue.remote.ts` に追加（`markIssueRead` と `$lib/notifications.remote` の `getUnreadCount` を import）:

```ts
export const readIssueNotifications = command(IssueRef, ({ key, number }) =>
	runCommand(async () => {
		await markIssueRead(remoteContext(), key, number);
		void getUnreadCount().refresh();
	})
);
```

- [ ] **Step 2: サイドバーのベル**

`AppSidebar.svelte`:
- import: `Bell`（`@lucide/svelte`）、`getUnreadCount`（`$lib/notifications.remote`）。
- script に追加:

```ts
	const unread = getUnreadCount();
	// 遷移ごとと、表示中は 60 秒ごとに取り直す
	afterNavigate(() => {
		menuOpen = false;
		void unread.refresh();
	});
	$effect(() => {
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') void unread.refresh();
		}, 60_000);
		return () => clearInterval(id);
	});
	const unreadLabel = $derived((unread.current ?? 0) > 99 ? '99+' : String(unread.current ?? 0));
```

（既存の `afterNavigate(() => { menuOpen = false; })` はこの新しい `afterNavigate` に統合する）

- 「すべてのプロジェクト」の `<a>` の直後（同じ `.group` 内）に追加:

```svelte
			<a
				href="/notifications"
				class="item row"
				aria-current={path === '/notifications' ? 'page' : undefined}
			>
				<Bell size={16} class="muted-icon" />通知
				{#if (unread.current ?? 0) > 0}
					<span class="badge" data-testid="unread-badge" aria-label={`未読 ${unreadLabel} 件`}
						>{unreadLabel}</span
					>
				{/if}
			</a>
```

- `<style>` に追加:

```css
	.badge {
		margin-left: auto;
		min-width: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 11px;
		font-weight: 600;
		line-height: 18px;
		text-align: center;
	}
```

`+layout.svelte` の `crumbs` で `if (path === '/account') ...` の次に追加:

```ts
		if (path === '/notifications') return [{ label: '通知' }];
```

- [ ] **Step 3: 通知ページ**

`src/routes/notifications/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { colorFor, formatDateTime } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import { getNotifications, openNotification, readAllNotifications } from '$lib/notifications.remote';

	const items = $derived(await getNotifications());
	const hasUnread = $derived(items.some((n) => !n.read));

	async function open(id: string) {
		try {
			const { href } = await openNotification({ id });
			await goto(href);
		} catch {
			toast.error('通知を開けませんでした');
		}
	}

	async function readAll() {
		try {
			await readAllNotifications();
		} catch {
			toast.error('既読にできませんでした');
		}
	}
</script>

<svelte:head><title>通知 | Project Manager</title></svelte:head>

<section class="grid w-full max-w-[800px] gap-4">
	<div class="flex items-center justify-between gap-4">
		<h1 class="m-0 text-xl font-bold">通知</h1>
		<button type="button" class="btn btn-outline btn-sm" disabled={!hasUnread} onclick={readAll}
			>すべて既読にする</button
		>
	</div>
	{#if items.length === 0}
		<p class="card m-0 text-muted-foreground">通知はありません</p>
	{:else}
		<ul class="card list notif-list">
			{#each items as n (n.id)}
				<li>
					<button type="button" class="notif" class:unread={!n.read} onclick={() => open(n.id)}>
						<span class="avatar" style:--c={colorFor(n.actorName)}>{n.actorName[0]}</span>
						<span class="grid min-w-0 gap-0.5 text-left">
							<span class="truncate"
								><span class="font-medium">{n.actorName}</span> さんが {n.summary}</span
							>
							<span class="truncate text-xs text-muted-foreground"
								>{n.projectKey}-{n.issueNumber} {n.issueTitle} · {formatDateTime(n.createdAt)}</span
							>
						</span>
						{#if !n.read}<span class="dot" aria-label="未読"></span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.notif-list {
		padding: 0;
	}
	.notif {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 16px;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.notif:hover {
		background: var(--muted);
	}
	.notif.unread {
		background: var(--ring-soft);
	}
	.dot {
		margin-left: auto;
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--primary);
	}
</style>
```

注: 既存のスタイル（`.card`, `.list`, `.avatar`, `.btn`）の見た目を `/admin/users` などで確かめ、合わない部分だけ調整する。`n.summary` は「担当者に設定しました」等、`さんが` の後に続けて読める文面になっている。

- [ ] **Step 4: 課題詳細**

`+page.svelte`:
- import に `readIssueNotifications` を足す。
- script に追加:

```ts
	// 開いた課題についての自分宛て未読を既読にする
	$effect(() => {
		void readIssueNotifications({ key: ref.key, number: ref.number }).catch(() => {});
	});
```

- コメントの `<article class="comment">` を `<article class="comment" id={`comment-${c.id}`}>` にする。
- `<style>` に追加:

```css
	.comment {
		scroll-margin-top: 80px;
	}
	.comment:target {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
```

- [ ] **Step 5: 検証して Commit**

Run: `pnpm check && pnpm lint && pnpm test:unit --run`
Expected: すべて PASS。続けて `pnpm dev` で次を目視確認する。別ユーザーで担当を変えるとベルに 1 が出る。`/notifications` で行を押すと課題に移動してバッジが消える。コメント通知ではそのコメントまでスクロールする。

```bash
git add src/lib/notifications.remote.ts src/routes/notifications src/lib/components/AppSidebar.svelte src/routes/+layout.svelte "src/routes/projects/[key]/issues/[number=int]"
git commit -m "feat(web): notification bell, notifications page and mark-as-read on issue view"
```

---

### Task 10: プロジェクト設定の「外部連携」

**Files:**
- Modify: `src/routes/projects/[key]/settings/+page.server.ts`
- Modify: `src/routes/projects/[key]/settings/+page.svelte`

**Interfaces:**
- Consumes: `listWebhooks`, `addWebhook`, `removeWebhook`, `testWebhook`, `WEBHOOK_PROVIDER_OPTIONS`（Task 7）

- [ ] **Step 1: load と actions**

`+page.server.ts`:
- `load` の `Promise.all` に `listWebhooks(ctx, params.key)` を足し、戻り値に `webhooks` と `providerOptions: WEBHOOK_PROVIDER_OPTIONS` を含める。
- `actions` に追加:

```ts
	addWebhook: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await addWebhook(appContext(locals), params.key, input);
		});
	},
	removeWebhook: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await removeWebhook(appContext(locals), params.key, id);
		});
	},
	testWebhook: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			const result = await testWebhook(appContext(locals), params.key, id);
			return { testResult: { id, ...result } };
		});
	},
```

- [ ] **Step 2: UI**

`+page.svelte`:
- import に `Webhook`（`@lucide/svelte`。無ければ `Link`）を足す。
- script に追加:

```ts
	$effect(() => {
		const r = form?.testResult;
		if (!r) return;
		if (r.ok) toast.success('テスト送信しました。チャンネルを確認してください');
		else toast.error(`テスト送信に失敗しました（${r.error}）`);
	});
```

- 「マイルストーン」カードの後、アーカイブのカードの前に追加:

```svelte
	<div class="card">
		<div class="card-head">
			<h2 class="card-title">外部連携</h2>
			<p class="card-desc">課題の作成・担当者の変更・ステータスの変更・コメントをチャットに投稿します</p>
		</div>
		<p class="hint m-0">
			課題のタイトルとコメントの抜粋がこのチャンネルに投稿されます。ゲストに見せたくない内容がある場合はチャンネルの参加者に注意してください。
		</p>
		{#if data.webhooks.length > 0}
			<ul class="list">
				{#each data.webhooks as w (w.id)}
					<li class="option-row">
						<Webhook size={16} class="row-icon shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate"
							>{w.providerLabel} <span class="text-muted-foreground">{w.maskedUrl}</span></span
						>
						<form method="POST" action="?/testWebhook" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="id" value={w.id} />
							<button type="submit" class="btn btn-ghost btn-xs">テスト送信</button>
						</form>
						<ConfirmAction
							action="?/removeWebhook"
							fields={{ id: w.id }}
							title="連携先の削除"
							description={`${w.providerLabel} への投稿を停止します。よろしいですか？`}
							confirmLabel="削除する"
							triggerClass="btn btn-ghost btn-xs"
						>
							{#snippet trigger()}削除{/snippet}
						</ConfirmAction>
					</li>
				{/each}
			</ul>
		{/if}
		<form
			method="POST"
			action="?/addWebhook"
			use:enhance
			class="grid items-end gap-3"
			style="grid-template-columns: auto minmax(0, 1fr) auto"
		>
			<div class="field">
				<label class="label" for="webhook-provider">連携先</label>
				<select class="input" id="webhook-provider" name="provider">
					{#each data.providerOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label class="label" for="webhook-url">Webhook URL</label>
				<input
					class="input"
					id="webhook-url"
					name="url"
					required
					placeholder="https://hooks.slack.com/services/..."
					aria-invalid={form?.fields?.url ? 'true' : undefined}
				/>
			</div>
			<button type="submit" class="btn btn-outline">追加</button>
		</form>
		{#if form?.fields?.url}<p class="field-error m-0">{form.fields.url[0]}</p>{/if}
	</div>
```

注: 既存のフィールドエラー表示クラス（`field-error` 等）が別名なら既存に合わせる。アーカイブ中でも連携の管理はできる（`writable` で隠さない）。

- [ ] **Step 3: 検証して Commit**

Run: `pnpm check && pnpm lint && pnpm test:unit --run`
Expected: PASS。`pnpm dev` で admin が URL を追加・テスト送信・削除できること、不正な URL でフィールドエラーが出ることを目視確認する。

```bash
git add "src/routes/projects/[key]/settings"
git commit -m "feat(web): manage Slack webhooks from project settings"
```

---

### Task 11: `@` 補完

**Files:**
- Create: `src/lib/caret.ts`
- Create: `src/lib/components/MentionMenu.svelte`
- Modify: `src/lib/components/MarkdownEditor.svelte`
- Modify: `src/routes/projects/[key]/issues/new/+page.server.ts`, `+page.svelte`
- Modify: `src/routes/projects/[key]/issues/[number=int]/+page.svelte`
- Modify: `src/routes/layout.css`

**Interfaces:**
- Consumes: `findMentionQuery`, `filterCandidates`, `mentionToken`, `MentionCandidate`（Task 1）
- Produces:
  - `caretRect(el: HTMLTextAreaElement, pos: number): { left: number; top: number; bottom: number }`（ビューポート座標）
  - `<MentionMenu target={() => HTMLTextAreaElement | undefined} candidates={MentionCandidate[]} />`
  - `MarkdownEditor` の prop `mentionCandidates?: MentionCandidate[]`

- [ ] **Step 1: キャレット座標**

`src/lib/caret.ts`:

```ts
// textarea と同じ見た目のミラー要素を作り、pos の位置に置いた span の座標を測る
const COPIED = [
	'box-sizing', 'width', 'border-top-width', 'border-right-width', 'border-bottom-width',
	'border-left-width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height',
	'font-family', 'text-align', 'text-transform', 'text-indent', 'letter-spacing', 'word-spacing',
	'tab-size'
];

export function caretRect(
	el: HTMLTextAreaElement,
	pos: number
): { left: number; top: number; bottom: number } {
	const cs = getComputedStyle(el);
	const mirror = document.createElement('div');
	for (const p of COPIED) mirror.style.setProperty(p, cs.getPropertyValue(p));
	mirror.style.setProperty('position', 'absolute');
	mirror.style.setProperty('visibility', 'hidden');
	mirror.style.setProperty('white-space', 'pre-wrap');
	mirror.style.setProperty('overflow-wrap', 'break-word');
	mirror.style.setProperty('top', '0');
	mirror.style.setProperty('left', '-9999px');
	mirror.textContent = el.value.slice(0, pos);
	const marker = document.createElement('span');
	marker.textContent = el.value.slice(pos) || '.';
	mirror.appendChild(marker);
	document.body.appendChild(mirror);
	const box = el.getBoundingClientRect();
	const left = box.left + marker.offsetLeft - el.scrollLeft;
	const top = box.top + marker.offsetTop - el.scrollTop;
	const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
	mirror.remove();
	return { left, top, bottom: top + lineHeight };
}
```

- [ ] **Step 2: MentionMenu**

`src/lib/components/MentionMenu.svelte`:

```svelte
<script lang="ts">
	import { caretRect } from '$lib/caret';
	import {
		filterCandidates,
		findMentionQuery,
		mentionToken,
		type MentionCandidate
	} from '$lib/mentions';

	let {
		target,
		candidates
	}: { target: () => HTMLTextAreaElement | undefined; candidates: MentionCandidate[] } = $props();

	let open = $state<{ start: number; query: string } | null>(null);
	let active = $state(0);
	let pos = $state({ left: 0, top: 0 });
	const items = $derived(open ? filterCandidates(candidates, open.query) : []);
	const listId = `mention-${Math.random().toString(36).slice(2)}`;

	function sync() {
		const el = target();
		if (!el) return;
		const q =
			el.selectionStart === el.selectionEnd ? findMentionQuery(el.value, el.selectionStart) : null;
		if (!q) {
			open = null;
			return;
		}
		if (open?.start !== q.start) active = 0;
		open = q;
		const r = caretRect(el, q.start);
		pos = { left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: r.bottom + 4 };
	}

	function pick(c: MentionCandidate) {
		const el = target();
		if (!el || !open) return;
		el.setRangeText(`${mentionToken(c)} `, open.start, el.selectionStart, 'end');
		// bind:value・autosize・remote form に変更を知らせる
		el.dispatchEvent(new Event('input', { bubbles: true }));
		open = null;
		el.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		// 日本語入力の変換確定の Enter では選ばない
		if (!open || items.length === 0 || e.isComposing) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const d = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + d + items.length) % items.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			pick(items[active]);
		} else if (e.key === 'Escape') {
			open = null;
		} else return;
		e.preventDefault();
		e.stopPropagation();
	}

	$effect(() => {
		const el = target();
		if (!el) return;
		const close = () => (open = null);
		el.addEventListener('input', sync);
		el.addEventListener('click', sync);
		el.addEventListener('keydown', onkeydown, true);
		el.addEventListener('blur', close);
		el.setAttribute('aria-autocomplete', 'list');
		return () => {
			el.removeEventListener('input', sync);
			el.removeEventListener('click', sync);
			el.removeEventListener('keydown', onkeydown, true);
			el.removeEventListener('blur', close);
		};
	});
</script>

{#if open && items.length > 0}
	<ul
		id={listId}
		class="mention-menu"
		role="listbox"
		aria-label="メンションする人"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
	>
		{#each items as c, i (c.id)}
			<!-- mousedown で選ぶ（click だと先に textarea の blur で閉じる） -->
			<li
				role="option"
				aria-selected={i === active}
				onmousedown={(e) => {
					e.preventDefault();
					pick(c);
				}}
			>
				{c.name}
			</li>
		{/each}
	</ul>
{/if}
```

`src/routes/layout.css` に追加（`.markdown .mention` の近く）:

```css
	.mention-menu {
		position: fixed;
		z-index: 50;
		width: 240px;
		max-height: 260px;
		overflow-y: auto;
		margin: 0;
		padding: 4px;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--popover, var(--background));
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
	}
	.mention-menu li {
		padding: 6px 8px;
		border-radius: 4px;
		cursor: pointer;
	}
	.mention-menu li[aria-selected='true'],
	.mention-menu li:hover {
		background: var(--muted);
	}
```

- [ ] **Step 3: 組み込み**

`MarkdownEditor.svelte`:
- props に `mentionCandidates?: MentionCandidate[]` を足す（`HTMLTextareaAttributes & { value?: string; projectKey?: string; mentionCandidates?: MentionCandidate[] }`）。
- `</div>`（`.editor` の閉じタグ）の直前に `{#if mentionCandidates}<MentionMenu target={() => textarea} candidates={mentionCandidates} />{/if}` を足す。
- ヒント文を `Markdown が使えます・@ でメンション{projectKey ? ...}` にする（`mentionCandidates` があるときだけ「・@ でメンション」を出す）。

起票ページ `issues/new/+page.server.ts` の load:

```ts
		const canAssign = can(ctx.actor, 'issue:assign');
		const [assignable, categories, milestones] = await Promise.all([
			listAssignableUsers(ctx.db, p.id),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key)
		]);
		return {
			canAssign,
			canSetStatus: can(ctx.actor, 'issue:changeStatus', { assigneeId: null }),
			assignees: canAssign ? assignable : [],
			mentionCandidates: assignable.map(({ id, name }) => ({ id, name })),
			categories,
			milestones: milestones.filter((m) => !m.completedAt)
		};
```

起票ページ `+page.svelte` の `<MarkdownEditor ...>` に `mentionCandidates={data.mentionCandidates}` を足す。

課題詳細 `+page.svelte`:
- import に `MentionMenu` を足す。
- script に追加:

```ts
	const mentionCandidates = $derived(
		detail.assignees.filter((u) => !u.disabled).map(({ id, name }) => ({ id, name }))
	);
	let editCommentInput = $state<HTMLTextAreaElement>();
```

- 説明の textarea（`id="issue-description"`）の直後に `<MentionMenu target={() => descriptionInput} candidates={mentionCandidates} />`。
- コメント編集の textarea に `bind:this={editCommentInput}` を足し、直後に `<MentionMenu target={() => editCommentInput} candidates={mentionCandidates} />`。
- 新規コメントの textarea（`id="new-comment"`）の直後に `<MentionMenu target={() => commentInput} candidates={mentionCandidates} />`。

- [ ] **Step 4: 検証して Commit**

Run: `pnpm check && pnpm lint && pnpm test:unit --run`
Expected: PASS。`pnpm dev` で次を目視確認する。
- コメント欄で `@` を打つと候補が出る。
- ↑↓ と Enter で選べ、`@[名前](user:...) ` が入る。
- 日本語入力の変換確定の Enter では候補が選ばれない。
- Esc で候補が閉じる。
- 投稿後はバッジ表示になる。

```bash
git add src/lib/caret.ts src/lib/components/MentionMenu.svelte src/lib/components/MarkdownEditor.svelte src/routes/layout.css "src/routes/projects/[key]/issues"
git commit -m "feat(web): @ mention autocomplete in issue and comment editors"
```

---

### Task 12: E2E とドキュメント

**Files:**
- Modify: `e2e/main-flow.spec.ts`
- Create: `apps/docs/src/content/docs/guides/slack.md`
- Modify: `apps/docs/astro.config.mjs`（`astro.config.*` の実ファイル名に合わせる）、`apps/docs/src/content/docs/reference/permissions.md`、`apps/docs/src/content/docs/index.mdx`

- [ ] **Step 1: E2E を追加**

手順 6（メンバーが担当者を設定して `reload` で確認した直後、`logout` の前）に追加:

```ts
	// 6b. メンバーが @ 補完でゲストをメンションしてコメント
	const mentionBox = page.getByLabel('コメントを追加');
	await mentionBox.click();
	await mentionBox.pressSequentially('@顧客');
	await page.getByRole('option', { name: '顧客 太郎' }).click();
	await mentionBox.pressSequentially('確認お願いします');
	await expect(mentionBox).toHaveValue(/^@\[顧客 太郎\]\(user:[0-9a-f-]{36}\) 確認お願いします$/);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown .mention', { hasText: '@顧客 太郎' })).toBeVisible();
```

手順 7 の `await login(page, 'guest@example.com');` の直後に追加:

```ts
	// 7a. ゲストに「担当」と「メンション」の 2 件が届いている
	const badge = page.getByTestId('unread-badge');
	await expect(badge).toHaveText('2');
	await page.getByRole('link', { name: /通知/ }).click();
	await expect(page).toHaveURL(/\/notifications$/);
	await expect(page.getByRole('button', { name: /担当者に設定しました/ })).toBeVisible();
	await page.getByRole('button', { name: /メンションしました: @顧客 太郎 確認お願いします/ }).click();
	await expect(page).toHaveURL(/\/projects\/ACME\/issues\/1#comment-[0-9a-f-]{36}$/);
	// 課題を開くと、その課題の通知はすべて既読になる
	await expect(badge).toBeHidden();
```

末尾（手順 10 の後）に追加:

```ts
	// 11. 管理者が Slack 連携を追加・削除する（実際の送信はしない）
	await page.goto('/projects/ACME/settings');
	await page.getByLabel('Webhook URL').fill('https://example.com/hook');
	await page.getByRole('button', { name: '追加' }).last().click();
	await expect(page.getByText('Slack の Webhook URL を入力してください')).toBeVisible();
	await page.getByLabel('Webhook URL').fill('https://hooks.slack.com/services/T000/B000/abcdef123456');
	await page.getByRole('button', { name: '追加' }).last().click();
	const hookRow = page.getByRole('listitem').filter({ hasText: '••••••••••••123456' });
	await expect(hookRow).toBeVisible();
	await expect(page.getByText('T000')).toBeHidden();
	await hookRow.getByRole('button', { name: '削除' }).click();
	await page.getByRole('alertdialog', { name: '連携先の削除' }).getByRole('button', { name: '削除する' }).click();
	await expect(hookRow).toBeHidden();
```

注: 「追加」ボタンはカテゴリー・マイルストーンにもある。`.last()` で取れない並びなら、手順 4b と同じく `page.locator('form', { has: page.getByLabel('Webhook URL') }).getByRole('button', { name: '追加' })` を使う。

Run: `pnpm test:e2e`
Expected: PASS

- [ ] **Step 2: ドキュメント**

`guides/slack.md`:

```md
---
title: Slack 連携
---

プロジェクトの出来事（課題の作成・担当者の変更・ステータスの変更・コメント・編集で追加されたメンション）を Slack のチャンネルに投稿できます。設定は管理者がプロジェクトごとに行います。

## 1. Slack で Incoming Webhook を作る

1. https://api.slack.com/apps で「Create New App」→「From scratch」を選び、ワークスペースを指定します。
2. 「Incoming Webhooks」を開いて有効にし、「Add New Webhook to Workspace」で投稿先のチャンネルを選びます。
3. 表示された `https://hooks.slack.com/services/...` の URL をコピーします。

## 2. プロジェクトに登録する

1. プロジェクトの「設定」→「外部連携」で、連携先に Slack を選び、URL を貼って「追加」します。
2. 「テスト送信」でチャンネルにメッセージが届くことを確認します。

1 つのプロジェクトに複数のチャンネルを登録できます。URL は登録後、末尾 6 文字だけが表示されます。

## 投稿される内容

- 「平野さんが コメント しました。」のような 1 行と、課題へのリンク
- コメントは本文の先頭 200 文字まで

課題のタイトルとコメントの抜粋がチャンネルに投稿されます。ゲストに見せたくない内容がある場合は、チャンネルの参加者に注意してください。

送信に失敗しても再送はしません（Worker のログに記録されます）。
```

`astro.config` の「はじめに」の items に `{ label: 'Slack 連携', slug: 'guides/slack' }` を「メール送信の設定」の後に足す。

`reference/permissions.md` の表の末尾に追加:

```md
| 自分宛ての通知の閲覧・既読化 | ○ | ○ | ○ |
| 外部連携（Slack）の設定 | ○ | × | × |
```

表の下の箇条書きに追加:

```md
- 通知は、自分が起票・担当・コメントした課題の出来事と、自分へのメンションで届きます。自分の操作では届きません。
```

`index.mdx` の「できること」に追加:

```md
- **通知** — 担当の割り当て、ステータスの変更、コメント、`@` メンションをアプリ内で通知
- **Slack 連携** — プロジェクトの出来事を Slack のチャンネルに投稿
```

- [ ] **Step 3: 全体検証**

Run: `pnpm check && pnpm lint && pnpm test:unit --run && pnpm test:e2e` と `pnpm --filter docs build`（ルートから。docs のビルドコマンドは `apps/docs/package.json` を確認）
Expected: すべて PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/main-flow.spec.ts ../docs
git commit -m "feat(web): e2e for notifications, mentions and webhook settings; docs: Slack integration"
```

---

## 完了後

- プレビュー環境に出す前に、プレビュー DB へマイグレーションを適用する（auto mode では拒否されるので、CLAUDE.md の `!` コマンドをユーザーに提示する）。適用後、`turso db shell project-manager-preview "SELECT name FROM sqlite_master WHERE name IN ('notification','project_webhook');"` で確認してから `pnpm deploy:preview`。
- 本番は「マイグレーション → デプロイ」の順。
