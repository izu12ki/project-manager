# Project Manager MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 受託開発会社と顧客（ゲスト）が課題を共有できる、Cloudflare Workers + Turso 上のセルフホスト型 OSS プロジェクト管理ツールの MVP と、そのドキュメントサイトを作る。

**Architecture:** pnpm monorepo（`apps/web` = SvelteKit 3 単体を 1 Worker にデプロイ、`apps/docs` = Astro Starlight）。業務ロジックと認可は `apps/web/src/lib/server/services/` のフレームワーク非依存な関数に集約し、`load` / form actions から呼ぶ。DB は Turso（libSQL）を Drizzle v1 rc で扱い、認証は better-auth（メール + パスワード）。

**Tech Stack:** SvelteKit 3.0 / Svelte 5 / adapter-cloudflare 8 / wrangler 4 / Tailwind CSS v4 / @lucide/svelte / drizzle-orm・drizzle-kit 1.0.0-rc.4 / @libsql/client 0.18.0 / better-auth 1.7.7 / valibot 1.5 / markdown-it 15 / fractional-indexing 4 / svelte-dnd-action 0.9.80 / uuidv7 1.2 / Vitest / Playwright / Astro Starlight / pnpm / mise

**Spec:** `docs/superpowers/specs/2026-10-09-project-manager-design.md`（特に 14 章「実装時の技術的補足」を必ず読むこと）

## Global Constraints

- Drizzle は `drizzle-orm@1.0.0-rc.4` / `drizzle-kit@1.0.0-rc.4` を **キャレットなしで固定**。`drizzle()` には `relations` を渡し、`schema` は渡さない。
- better-auth は `better-auth@1.7.7` と `@better-auth/drizzle-adapter@1.7.7`（`/relations-v2` サブパスを使う）。
- Cloudflare のバインディング/シークレットは `import { env, waitUntil } from 'cloudflare:workers'` で取得する。これを import してよいのは `src/hooks.server.ts` だけ。`platform.env` は存在しない。
- `building` は `$app/env` から import する（`$app/environment` は使わない）。
- wrangler の `compatibility_flags` に `nodejs_compat` を含める。
- ID は UUIDv7（`uuidv7` パッケージ）の text、日時は integer ms（Drizzle `timestamp_ms`）。
- UI 文言は日本語のみ。メール本文は日英併記。
- ライセンスは MIT。
- 権限は spec 3 章の表どおり。未参加プロジェクト/権限なし操作は 404（`error(404)`）。
- 招待リンクのコピー（再発行）ボタンのすぐ横に、常時表示で「コピーすると招待を再発行し、以前のリンクは無効になります」と書く。
- サーバー側の import エイリアスは `$lib/...` を使う（SvelteKit 3 でも有効）。
- テストは `apps/web` で `pnpm test:unit --run`（Vitest、node 環境、libSQL `:memory:`）。

## Review Focus

1. **同時起票での課題番号の重複** — 複数人が同時に起票しても `ACME-1, ACME-2…` が重複・欠番しないこと（Task 7 で `Promise.all` による同時起票テストを追加）。
2. **カンバンの古い並び順での移動** — 他人の操作後の古い画面からドラッグしても、データが壊れず「再読み込みしてください」と返り、画面が元に戻ること（Task 7 で別ステータスの隣接 ID を渡すテスト、Task 11 で失敗時のロールバック）。
3. **使用済み・期限切れ・再発行済みの招待リンク** — もう一度開いたら「無効か期限切れ」と表示され、アカウントが作られないこと（Task 5 でテスト）。
4. **無効化されたユーザーの既存セッション** — 無効化した瞬間にセッションが消え、ログインも拒否されること（Task 6 でテスト、Task 9 の hooks で強制）。
5. **ログイン後のリダイレクト先の悪用（open redirect）と Markdown 経由の XSS** — `redirectTo=//evil.example` や `javascript:` リンク、`<script>` が無害化されること（Task 4 でテスト）。

---

## File Structure

```
project-manager/
├─ mise.toml / pnpm-workspace.yaml / package.json / LICENSE / README.md / .gitignore
├─ .github/workflows/ci.yml
├─ apps/web/
│  ├─ package.json / vite.config.ts / wrangler.jsonc / drizzle.config.ts / playwright.config.ts
│  ├─ .dev.vars.example
│  ├─ drizzle/                         # 生成されたマイグレーション
│  ├─ scripts/e2e-server.sh            # E2E 用: turso dev + migrate + build + wrangler dev
│  ├─ e2e/main-flow.spec.ts
│  └─ src/
│     ├─ app.d.ts / app.html / hooks.server.ts
│     ├─ lib/
│     │  ├─ labels.ts                  # ステータス/優先度/ロールの表示名（クライアント共用）
│     │  ├─ components/InviteLinkBox.svelte
│     │  └─ server/
│     │     ├─ env.ts                  # env の検証（valibot）
│     │     ├─ db/index.ts             # createDb, DB, Tx 型
│     │     ├─ db/schema.ts            # 全テーブル + relations
│     │     ├─ errors.ts               # AppError, handleAction, handleLoad
│     │     ├─ validation.ts           # parse, formObject, 共通スキーマ
│     │     ├─ authz.ts                # Role, Actor, can, authorize
│     │     ├─ context.ts              # BaseContext, AppContext, appContext()
│     │     ├─ tokens.ts               # randomToken, sha256Hex
│     │     ├─ ratelimit.ts            # consumeRateLimit
│     │     ├─ redirect.ts             # safeRedirect
│     │     ├─ markdown.ts             # renderMarkdown
│     │     ├─ mailer/index.ts         # Mailer, createMailer
│     │     ├─ mailer/templates.ts     # invitationMail, resetPasswordMail
│     │     ├─ auth.ts                 # createAuth
│     │     ├─ test-utils.ts           # テスト専用ヘルパ（アプリからは import しない）
│     │     └─ services/
│     │        ├─ credentials.ts       # insertCredentialUser
│     │        ├─ setup.ts             # needsSetup, createFirstAdmin
│     │        ├─ invitations.ts
│     │        ├─ users.ts
│     │        ├─ projects.ts
│     │        ├─ issues.ts
│     │        └─ comments.ts
│     └─ routes/
│        ├─ +layout.server.ts / +layout.svelte / layout.css / +page.server.ts / +page.svelte
│        ├─ login/ setup/ forgot-password/ reset-password/ invite/[token]/ logout/ account/
│        ├─ admin/+layout.server.ts / admin/users/ / admin/projects/new/
│        └─ projects/[key]/ (+layout.*, +page.*, board/, settings/, issues/new/, issues/[number]/)
└─ apps/docs/                          # Astro Starlight
```

---

### Task 1: モノレポと SvelteKit アプリの土台

**Files:**
- Create: `mise.toml`, `pnpm-workspace.yaml`, `package.json`, `LICENSE`, `.gitignore`
- Create (scaffold): `apps/web/**`
- Modify: `apps/web/package.json`, `apps/web/wrangler.jsonc`, `apps/web/src/app.d.ts`, `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`
- Create: `apps/web/.dev.vars.example`, `apps/web/src/lib/labels.ts`, `apps/web/src/lib/labels.test.ts`

**Interfaces:**
- Produces: `STATUSES`, `Status`, `STATUS_LABEL`, `PRIORITIES`, `Priority`, `PRIORITY_LABEL`, `ROLE_LABEL`（`$lib/labels`）

- [ ] **Step 1: mise とワークスペースを作る**

`mise.toml`:
```toml
[tools]
node = "24"
pnpm = "12"
turso = "1.0.34"
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
```

`package.json`:
```json
{
	"name": "project-manager",
	"private": true,
	"license": "MIT",
	"scripts": {
		"dev": "pnpm --filter web dev",
		"lint": "pnpm --filter web lint",
		"check": "pnpm --filter web check",
		"test:unit": "pnpm --filter web test:unit --run",
		"test:e2e": "pnpm --filter web test:e2e",
		"docs:dev": "pnpm --filter docs dev",
		"docs:build": "pnpm --filter docs build"
	}
}
```

`.gitignore`:
```
node_modules
.DS_Store
```

`LICENSE`: MIT ライセンス全文。著作権行は `Copyright (c) 2026 izu12ki`。

Run: `mise install && node -v && pnpm -v && turso --version`
Expected: v24.x / 12.x / turso 1.0.34

- [ ] **Step 2: SvelteKit アプリを生成する**

```bash
pnpm dlx sv@1.1.1 create apps/web --template minimal --types ts \
  --add prettier eslint "vitest=usages:unit" "playwright=demo:no" \
        "tailwindcss=plugins:none" "sveltekit-adapter=adapter:cloudflare+cfTarget:workers" \
  --install pnpm --no-dir-check
```

`pnpm install` の出力に "Ignored build scripts" が出た場合は、そこに列挙されたパッケージ（例: `esbuild`, `workerd`, `@tailwindcss/oxide`）をルートの `pnpm-workspace.yaml` の `onlyBuiltDependencies:` に追加して `pnpm install` をやり直す。pnpm 12 でキー名が変わっていてエラーになる場合は、pnpm の警告メッセージが示すキー名を使う。

- [ ] **Step 3: 依存を追加する**

```bash
cd apps/web
pnpm add drizzle-orm@1.0.0-rc.4 @libsql/client@0.18.0 better-auth@1.7.7 @better-auth/drizzle-adapter@1.7.7 \
  valibot@1.5.0 uuidv7@1.2.1 markdown-it@15.0.2 fractional-indexing@4.0.0 svelte-dnd-action@0.9.80 @lucide/svelte
pnpm add -D drizzle-kit@1.0.0-rc.4
```

`apps/web/package.json` の `dependencies` で `drizzle-orm` と `drizzle-kit` が `1.0.0-rc.4`（`^` なし）になっていることを確認する。なっていなければ手で `^` を外して `pnpm install`。

- [ ] **Step 4: scaffold を調整する**

`apps/web/package.json` の `scripts` を次に置き換える（`name` は `web` のまま）:
```json
{
	"dev": "vite dev",
	"build": "wrangler types && vite build",
	"preview": "wrangler dev .svelte-kit/cloudflare/_worker.js --port 4173",
	"prepare": "svelte-kit sync || echo ''",
	"check": "wrangler types && svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
	"lint": "prettier --check . && eslint .",
	"format": "prettier --write .",
	"test:unit": "vitest",
	"test:e2e": "playwright test",
	"gen": "wrangler types",
	"db:generate": "drizzle-kit generate",
	"db:migrate": "drizzle-kit migrate",
	"db:local": "turso dev --db-file local.db --port 8080",
	"deploy": "pnpm build && wrangler deploy"
}
```

`apps/web/.gitignore` の末尾に追加:
```
worker-configuration.d.ts
.dev.vars
local.db*
e2e.db*
```

`apps/web/wrangler.jsonc` を次にする（`compatibility_date` は scaffold が書いた値を残す）:
```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "project-manager",
	"compatibility_date": "2026-10-09",
	"compatibility_flags": ["nodejs_compat"],
	"main": ".svelte-kit/cloudflare/_worker.js",
	"assets": { "binding": "ASSETS", "directory": ".svelte-kit/cloudflare" },
	"workers_dev": true,
	"preview_urls": true,
	"observability": { "enabled": true }
}
```

`apps/web/src/app.d.ts`（scaffold の `Platform` ブロックは adapter 8 では使えないので削除。`Locals` は Task 9 で埋める）:
```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Locals {}  -- Task 9 で定義
	}
}

export {};
```

`apps/web/vite.config.ts` の `test` を node 環境の 1 プロジェクトだけにする（ブラウザテストは使わない）:
```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
```
`@vitest/browser-playwright` と `vitest-browser-svelte` が devDependencies にあれば `pnpm remove` する。scaffold の `src/routes/page.svelte.e2e.ts` を削除する。`playwright.config.ts` は Task 12 で書き換えるので、ここでは削除せず残す。

`apps/web/.dev.vars.example`:
```
TURSO_DATABASE_URL=http://127.0.0.1:8080
BETTER_AUTH_SECRET=replace-with-output-of-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:5173
MAIL_PROVIDER=console
# MAIL_API_KEY=
# MAIL_FROM=Project Manager <noreply@example.com>
```

- [ ] **Step 5: 表示名の定義を TDD で作る**

`apps/web/src/lib/labels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from './labels';

describe('labels', () => {
	it('全ステータスに表示名がある', () => {
		expect(STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done']);
		for (const s of STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
	});
	it('全優先度に表示名がある', () => {
		expect(PRIORITIES).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
		for (const p of PRIORITIES) expect(PRIORITY_LABEL[p]).toBeTruthy();
	});
});
```

Run: `cd apps/web && pnpm test:unit --run src/lib/labels.test.ts`
Expected: FAIL（`./labels` が無い）

`apps/web/src/lib/labels.ts`:
```ts
export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
	todo: '未着手',
	in_progress: '進行中',
	in_review: 'レビュー中',
	done: '完了'
};

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
	none: 'なし',
	low: '低',
	medium: '中',
	high: '高',
	urgent: '緊急'
};

export const ROLE_LABEL = { admin: '管理者', member: 'メンバー', guest: 'ゲスト' } as const;
```

Run: `pnpm test:unit --run src/lib/labels.test.ts`
Expected: PASS

- [ ] **Step 6: 全体チェック**

Run: `cd apps/web && pnpm format && pnpm lint && pnpm check && pnpm build`
Expected: すべて成功（0 errors）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo and SvelteKit app for Cloudflare Workers"
```

---

### Task 2: DB スキーマ・クライアント・マイグレーション

**Files:**
- Create: `apps/web/src/lib/server/db/schema.ts`, `apps/web/src/lib/server/db/index.ts`, `apps/web/drizzle.config.ts`, `apps/web/src/lib/server/test-utils.ts`, `apps/web/src/lib/server/db/schema.test.ts`
- Create (generated): `apps/web/drizzle/<timestamp>_init/`

**Interfaces:**
- Consumes: `STATUSES`, `PRIORITIES`（`$lib/labels`）
- Produces:
  - tables: `user`, `session`, `account`, `verification`, `rateLimit`, `invitation`, `project`, `projectMember`, `issue`, `comment`, `relations`（`$lib/server/db/schema`）
  - `createDb(env: { TURSO_DATABASE_URL: string; TURSO_AUTH_TOKEN?: string }): DB`, `type DB`, `type Tx`（`$lib/server/db`）
  - test-utils: `createTestDb(): Promise<DB>`（Task 3 以降で拡張）

- [ ] **Step 1: スキーマを書く**

`apps/web/src/lib/server/db/schema.ts`:
```ts
import { defineRelations, sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { PRIORITIES, STATUSES } from '$lib/labels';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(now)
		.$onUpdate(() => new Date());

// ---- better-auth（キー名は better-auth のフィールド名と一致させること） ----

export const user = sqliteTable(
	'user',
	{
		id: text().primaryKey(),
		name: text().notNull(),
		email: text().notNull(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
		image: text(),
		role: text({ enum: ['admin', 'member', 'guest'] })
			.notNull()
			.default('member'),
		disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('user_email_uq').on(t.email)]
);

export const session = sqliteTable(
	'session',
	{
		id: text().primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [uniqueIndex('session_token_uq').on(t.token), index('session_user_id_idx').on(t.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text().primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text(),
		password: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('account_user_id_idx').on(t.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text().primaryKey(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

export const rateLimit = sqliteTable(
	'rate_limit',
	{
		id: text().primaryKey(),
		key: text().notNull(),
		count: integer().notNull(),
		lastRequest: integer('last_request').notNull()
	},
	(t) => [uniqueIndex('rate_limit_key_uq').on(t.key)]
);

// ---- アプリ ----

export const project = sqliteTable(
	'project',
	{
		id: text().primaryKey(),
		key: text().notNull(),
		name: text().notNull(),
		description: text().notNull().default(''),
		nextIssueNumber: integer('next_issue_number').notNull().default(1),
		archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('project_key_uq').on(t.key)]
);

export const projectMember = sqliteTable(
	'project_member',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.userId] }),
		index('project_member_user_idx').on(t.userId)
	]
);

export const invitation = sqliteTable(
	'invitation',
	{
		id: text().primaryKey(),
		email: text().notNull(),
		role: text({ enum: ['member', 'guest'] }).notNull(),
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		invitedBy: text('invited_by')
			.notNull()
			.references(() => user.id),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('invitation_token_hash_uq').on(t.tokenHash),
		index('invitation_email_idx').on(t.email)
	]
);

export const issue = sqliteTable(
	'issue',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		number: integer().notNull(),
		title: text().notNull(),
		description: text().notNull().default(''),
		status: text({ enum: STATUSES }).notNull().default('todo'),
		priority: text({ enum: PRIORITIES }).notNull().default('none'),
		assigneeId: text('assignee_id').references(() => user.id),
		reporterId: text('reporter_id')
			.notNull()
			.references(() => user.id),
		dueDate: text('due_date'),
		position: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('issue_project_number_uq').on(t.projectId, t.number),
		index('issue_board_idx').on(t.projectId, t.status, t.position),
		index('issue_assignee_idx').on(t.assigneeId)
	]
);

export const comment = sqliteTable(
	'comment',
	{
		id: text().primaryKey(),
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		body: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('comment_issue_idx').on(t.issueId)]
);

// better-auth の Drizzle アダプタ（relations-v2）が使う。アプリ側のクエリはコア API（select/join）で書く。
export const relations = defineRelations({ user, session, account, verification, rateLimit }, (r) => ({
	user: { sessions: r.many.session(), accounts: r.many.account() },
	session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
	account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) }
}));
```

- [ ] **Step 2: DB クライアントと drizzle-kit 設定**

`apps/web/src/lib/server/db/index.ts`:
```ts
import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';
import { relations } from './schema';

export function createDb(env: { TURSO_DATABASE_URL: string; TURSO_AUTH_TOKEN?: string }) {
	const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
	return drizzle({ client, relations });
}

export type DB = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
```

`apps/web/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'turso',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.TURSO_DATABASE_URL ?? 'http://127.0.0.1:8080',
		authToken: process.env.TURSO_AUTH_TOKEN
	}
});
```

- [ ] **Step 3: マイグレーションを生成する**

Run: `cd apps/web && pnpm db:generate --name init`
Expected: `drizzle/<timestamp>_init/migration.sql` と `snapshot.json` ができる。`migration.sql` に 10 個の `CREATE TABLE` があることを目視確認する。

`schema.ts` が `$lib/labels` を import しているため drizzle-kit がエイリアスを解決できずに失敗した場合は、`schema.ts` の import を相対パス `'../../labels'` に変えてやり直す。

- [ ] **Step 4: テスト用 DB ヘルパとスキーマのテストを書く**

`apps/web/src/lib/server/test-utils.ts`:
```ts
// テスト専用。アプリのコードから import しないこと。
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import type { DB } from './db';
import { relations } from './db/schema';

export async function createTestDb(): Promise<DB> {
	const db = drizzle({ client: createClient({ url: ':memory:' }), relations });
	await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)) });
	return db as unknown as DB;
}
```

`apps/web/src/lib/server/db/schema.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test-utils';
import { comment, issue, project, user } from './schema';

describe('schema', () => {
	it('マイグレーションが適用され、課題削除でコメントが連鎖削除される', async () => {
		const db = await createTestDb();
		await db.insert(user).values({ id: 'u1', name: 'A', email: 'a@example.com', role: 'admin' });
		await db.insert(project).values({ id: 'p1', key: 'ACME', name: 'Acme' });
		await db.insert(issue).values({
			id: 'i1', projectId: 'p1', number: 1, title: 't', reporterId: 'u1', position: 'a0'
		});
		await db.insert(comment).values({ id: 'c1', issueId: 'i1', authorId: 'u1', body: 'hi' });

		await db.delete(issue).where(eq(issue.id, 'i1'));

		expect(await db.select().from(comment)).toHaveLength(0);
		const [p] = await db.select().from(project);
		expect(p.nextIssueNumber).toBe(1);
		expect(p.createdAt).toBeInstanceOf(Date);
	});

	it('同じプロジェクトで課題番号は重複できない', async () => {
		const db = await createTestDb();
		await db.insert(user).values({ id: 'u1', name: 'A', email: 'a@example.com', role: 'admin' });
		await db.insert(project).values({ id: 'p1', key: 'ACME', name: 'Acme' });
		const row = { projectId: 'p1', number: 1, title: 't', reporterId: 'u1', position: 'a0' };
		await db.insert(issue).values({ id: 'i1', ...row });
		await expect(db.insert(issue).values({ id: 'i2', ...row })).rejects.toThrow();
	});
});
```

- [ ] **Step 5: テスト実行**

Run: `pnpm test:unit --run src/lib/server/db`
Expected: PASS（2 tests）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): add drizzle schema, libsql client and initial migration"
```

---

### Task 3: エラー・バリデーション・認可・コンテキスト

**Files:**
- Create: `apps/web/src/lib/server/errors.ts`, `validation.ts`, `authz.ts`, `context.ts`, `tokens.ts`
- Test: `apps/web/src/lib/server/authz.test.ts`, `validation.test.ts`, `errors.test.ts`, `tokens.test.ts`
- Modify: `apps/web/src/lib/server/test-utils.ts`

**Interfaces:**
- Produces:
  - `class AppError extends Error { code: ErrorCode; fields?: Record<string, string[]> }`, `type ErrorCode = 'not_found' | 'forbidden' | 'validation' | 'conflict' | 'rate_limited'`
  - `handleAction<T>(fn: () => Promise<T>): Promise<T | ActionFailure<{ message: string; fields: Record<string, string[]> }>>`
  - `handleLoad<T>(fn: () => Promise<T>): Promise<T>`
  - `parse<S>(schema: S, input: unknown): InferOutput<S>`, `formObject(fd: FormData): Record<string, string>`, `emptyToNull(s: string | undefined): string | null | undefined`, `EmailSchema`, `NameSchema`, `PasswordSchema`
  - `type Role`, `interface Actor { id; name; email; role }`, `type Action`, `can(actor, action, res?)`, `authorize(actor, action, res?)`
  - `interface BaseContext { db; mailer; waitUntil; baseUrl; hashPassword }`, `interface AppContext extends BaseContext { actor: Actor }`, `appContext(locals): AppContext`
  - `randomToken(): string`, `sha256Hex(s: string): Promise<string>`
  - test-utils: `createTestBase(db, overrides?)`, `seedUser(db, role, name?)`, `seedProject(db, opts)`, `ctxOf(base, actor)`

- [ ] **Step 1: 失敗するテストを書く（authz）**

`apps/web/src/lib/server/authz.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { can, type Action, type Actor } from './authz';

const admin: Actor = { id: 'a', name: 'A', email: 'a@x', role: 'admin' };
const member: Actor = { id: 'm', name: 'M', email: 'm@x', role: 'member' };
const guest: Actor = { id: 'g', name: 'G', email: 'g@x', role: 'guest' };

// [action, resource, admin, member, guest]
const table: [Action, Parameters<typeof can>[2], boolean, boolean, boolean][] = [
	['user:manage', {}, true, false, false],
	['project:manage', {}, true, false, false],
	['issue:create', {}, true, true, true],
	['comment:create', {}, true, true, true],
	['issue:edit', { reporterId: 'x' }, true, true, false],
	['issue:edit', { reporterId: 'g' }, true, true, true],
	['issue:changeStatus', { assigneeId: null }, true, true, false],
	['issue:changeStatus', { assigneeId: 'x' }, true, true, false],
	['issue:changeStatus', { assigneeId: 'g' }, true, true, true],
	['issue:assign', {}, true, true, false],
	['issue:delete', {}, true, true, false],
	['comment:modify', { authorId: 'x' }, true, false, false],
	['comment:modify', { authorId: 'm' }, true, true, false],
	['comment:modify', { authorId: 'g' }, true, false, true]
];

describe('can', () => {
	it.each(table)('%s %j → admin=%s member=%s guest=%s', (action, res, a, m, g) => {
		expect(can(admin, action, res)).toBe(a);
		expect(can(member, action, res)).toBe(m);
		expect(can(guest, action, res)).toBe(g);
	});
});
```

Run: `pnpm test:unit --run src/lib/server/authz.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 2: errors.ts と authz.ts を実装する**

`apps/web/src/lib/server/errors.ts`:
```ts
import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';

export type ErrorCode = 'not_found' | 'forbidden' | 'validation' | 'conflict' | 'rate_limited';

export class AppError extends Error {
	constructor(
		public code: ErrorCode,
		message: string,
		public fields?: Record<string, string[]>
	) {
		super(message);
		this.name = 'AppError';
	}
}

const FAIL_STATUS = { validation: 400, conflict: 409, rate_limited: 429 } as const;

export async function handleAction<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (e) {
		if (!(e instanceof AppError)) throw e;
		if (e.code === 'not_found' || e.code === 'forbidden') error(404, 'Not found');
		return fail(FAIL_STATUS[e.code], { message: e.message, fields: e.fields ?? {} });
	}
}

export async function handleLoad<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (isRedirect(e) || isHttpError(e) || !(e instanceof AppError)) throw e;
		if (e.code === 'not_found' || e.code === 'forbidden') error(404, 'Not found');
		error(400, e.message);
	}
}
```

`apps/web/src/lib/server/authz.ts`:
```ts
import { AppError } from './errors';

export type Role = 'admin' | 'member' | 'guest';

export interface Actor {
	id: string;
	name: string;
	email: string;
	role: Role;
}

export type Action =
	| 'user:manage'
	| 'project:manage'
	| 'issue:create'
	| 'issue:edit'
	| 'issue:changeStatus'
	| 'issue:assign'
	| 'issue:delete'
	| 'comment:create'
	| 'comment:modify';

export interface Resource {
	reporterId?: string;
	assigneeId?: string | null;
	authorId?: string;
}

export function can(actor: Actor, action: Action, res: Resource = {}): boolean {
	if (actor.role === 'admin') return true;
	const isMember = actor.role === 'member';
	switch (action) {
		case 'user:manage':
		case 'project:manage':
			return false;
		case 'issue:create':
		case 'comment:create':
			return true;
		case 'issue:assign':
		case 'issue:delete':
			return isMember;
		case 'issue:edit':
			return isMember || res.reporterId === actor.id;
		case 'issue:changeStatus':
			return isMember || (res.assigneeId != null && res.assigneeId === actor.id);
		case 'comment:modify':
			return res.authorId === actor.id;
	}
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
```

Run: `pnpm test:unit --run src/lib/server/authz.test.ts`
Expected: PASS

- [ ] **Step 3: 失敗するテストを書く（validation / errors / tokens）**

`apps/web/src/lib/server/validation.test.ts`:
```ts
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { EmailSchema, emptyToNull, formObject, parse, PasswordSchema } from './validation';

describe('validation', () => {
	it('メールアドレスを trim して小文字にする', () => {
		expect(parse(EmailSchema, '  Foo@Example.COM ')).toBe('foo@example.com');
	});
	it('不正な入力は AppError(validation) をフィールド付きで投げる', () => {
		const S = v.object({ email: EmailSchema, password: PasswordSchema });
		try {
			parse(S, { email: 'bad', password: 'short' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(AppError);
			expect((e as AppError).code).toBe('validation');
			expect(Object.keys((e as AppError).fields ?? {})).toEqual(['email', 'password']);
		}
	});
	it('formObject は文字列の値だけを取り出す', () => {
		const fd = new FormData();
		fd.set('a', 'x');
		fd.set('b', '');
		fd.set('f', new Blob(['x']));
		expect(formObject(fd)).toEqual({ a: 'x', b: '' });
	});
	it('emptyToNull', () => {
		expect(emptyToNull(undefined)).toBeUndefined();
		expect(emptyToNull('')).toBeNull();
		expect(emptyToNull('x')).toBe('x');
	});
});
```

`apps/web/src/lib/server/errors.test.ts`:
```ts
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { AppError, handleAction } from './errors';

describe('handleAction', () => {
	it('validation は 400 の fail にする', async () => {
		const r = await handleAction(async () => {
			throw new AppError('validation', 'だめ', { title: ['必須'] });
		});
		expect(isActionFailure(r) && r.status).toBe(400);
		expect(isActionFailure(r) && r.data).toEqual({ message: 'だめ', fields: { title: ['必須'] } });
	});
	it('forbidden は 404 にする（存在を隠す）', async () => {
		try {
			await handleAction(async () => {
				throw new AppError('forbidden', 'x');
			});
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(404);
		}
	});
	it('AppError 以外はそのまま投げる', async () => {
		await expect(
			handleAction(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
	});
});
```

`apps/web/src/lib/server/tokens.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from './tokens';

describe('tokens', () => {
	it('randomToken は 43 文字の base64url で毎回異なる', () => {
		const a = randomToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(randomToken()).not.toBe(a);
	});
	it('sha256Hex', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
```

Run: `pnpm test:unit --run src/lib/server`
Expected: validation / tokens が FAIL（モジュールが無い）

- [ ] **Step 4: validation.ts / tokens.ts / context.ts を実装する**

`apps/web/src/lib/server/validation.ts`:
```ts
import * as v from 'valibot';
import { AppError } from './errors';

export function parse<S extends v.GenericSchema>(schema: S, input: unknown): v.InferOutput<S> {
	const r = v.safeParse(schema, input);
	if (r.success) return r.output;
	const flat = v.flatten<S>(r.issues);
	throw new AppError(
		'validation',
		flat.root?.[0] ?? '入力内容を確認してください',
		(flat.nested ?? {}) as Record<string, string[]>
	);
}

export function formObject(fd: FormData): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, val] of fd.entries()) if (typeof val === 'string') out[k] = val;
	return out;
}

export function emptyToNull(s: string | undefined): string | null | undefined {
	if (s === undefined) return undefined;
	return s === '' ? null : s;
}

export const EmailSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.email('メールアドレスの形式が正しくありません')
);
export const NameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, '名前を入力してください'),
	v.maxLength(50, '名前は50文字以内で入力してください')
);
export const PasswordSchema = v.pipe(
	v.string(),
	v.minLength(10, 'パスワードは10文字以上にしてください'),
	v.maxLength(128, 'パスワードは128文字以内にしてください')
);
```

`apps/web/src/lib/server/tokens.ts`:
```ts
export function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`apps/web/src/lib/server/context.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import type { Actor } from './authz';
import type { DB } from './db';
import type { Mailer } from './mailer';

export interface BaseContext {
	db: DB;
	mailer: Mailer;
	waitUntil: (p: Promise<unknown>) => void;
	baseUrl: string;
	hashPassword: (password: string) => Promise<string>;
}

export interface AppContext extends BaseContext {
	actor: Actor;
}

export function appContext(locals: { base: BaseContext; user: Actor | null }): AppContext {
	if (!locals.user) redirect(303, '/login');
	return { ...locals.base, actor: locals.user };
}
```

`context.ts` は `./mailer` の型を参照するので、Task 4 の前に最小の型だけ置く。`apps/web/src/lib/server/mailer/index.ts`:
```ts
export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface Mailer {
	send(msg: MailMessage): Promise<void>;
}
```

- [ ] **Step 5: test-utils を拡張する**

`apps/web/src/lib/server/test-utils.ts` の末尾に追加（import も先頭に追加）:
```ts
import { uuidv7 } from 'uuidv7';
import type { Actor, Role } from './authz';
import type { AppContext, BaseContext } from './context';
import { project, projectMember, user } from './db/schema';
import type { MailMessage } from './mailer';

export function createTestBase(
	db: DB,
	overrides: Partial<BaseContext> = {}
): BaseContext & { sent: MailMessage[] } {
	const sent: MailMessage[] = [];
	return {
		db,
		mailer: {
			send: async (m) => {
				sent.push(m);
			}
		},
		waitUntil: (p) => {
			void p;
		},
		baseUrl: 'http://localhost:5173',
		hashPassword: async (pw) => `test-hash:${pw}`,
		sent,
		...overrides
	};
}

export async function seedUser(db: DB, role: Role, name: string = role): Promise<Actor> {
	const id = uuidv7();
	const email = `${name}-${id.slice(-8)}@example.com`.toLowerCase();
	await db.insert(user).values({ id, name, email, role, emailVerified: true });
	return { id, name, email, role };
}

export async function seedProject(
	db: DB,
	opts: { key?: string; name?: string; members?: Actor[]; archived?: boolean } = {}
) {
	const id = uuidv7();
	const key = opts.key ?? 'ACME';
	await db.insert(project).values({
		id,
		key,
		name: opts.name ?? 'Acme',
		archivedAt: opts.archived ? new Date() : null
	});
	for (const m of opts.members ?? []) {
		await db.insert(projectMember).values({ projectId: id, userId: m.id });
	}
	return { id, key };
}

export function ctxOf(base: BaseContext, actor: Actor): AppContext {
	return { ...base, actor };
}
```

- [ ] **Step 6: テスト実行**

Run: `pnpm test:unit --run src/lib/server && pnpm check`
Expected: PASS / 0 errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(server): add errors, validation, authorization and request context"
```

---

### Task 4: メール送信・Markdown・レート制限・リダイレクト検証

**Files:**
- Modify: `apps/web/src/lib/server/mailer/index.ts`
- Create: `apps/web/src/lib/server/mailer/templates.ts`, `apps/web/src/lib/server/markdown.ts`, `apps/web/src/lib/server/ratelimit.ts`, `apps/web/src/lib/server/redirect.ts`
- Test: `apps/web/src/lib/server/mailer/mailer.test.ts`, `markdown.test.ts`, `ratelimit.test.ts`, `redirect.test.ts`

**Interfaces:**
- Produces:
  - `createMailer(env: MailEnv, fetchFn?: typeof fetch): Mailer`, `interface MailEnv { MAIL_PROVIDER: 'smtp2go' | 'resend' | 'console'; MAIL_API_KEY?: string; MAIL_FROM?: string }`
  - `invitationMail(p: { url: string; inviterName: string; projectName: string | null }): { subject: string; text: string }`, `resetPasswordMail(p: { url: string }): { subject: string; text: string }`
  - `renderMarkdown(src: string): string`
  - `consumeRateLimit(db: DB, key: string, limit: { windowMs: number; max: number }, now?: number): Promise<boolean>`、定数 `LOGIN_LIMIT`, `RESET_LIMIT`, `SIGNUP_LIMIT`
  - `safeRedirect(target: string | null, fallback?: string): string`

- [ ] **Step 1: 失敗するテストを書く（mailer）**

`apps/web/src/lib/server/mailer/mailer.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createMailer } from './index';

const msg = { to: 'to@example.com', subject: 'S', text: 'T' };

function okFetch() {
	return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch & {
		mock: { calls: [string, RequestInit][] };
	};
}

describe('createMailer', () => {
	it('smtp2go: API キーをヘッダに載せて JSON を POST する', async () => {
		const f = okFetch();
		await createMailer({ MAIL_PROVIDER: 'smtp2go', MAIL_API_KEY: 'k', MAIL_FROM: 'PM <a@x.com>' }, f).send(msg);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.smtp2go.com/v3/email/send');
		expect((init.headers as Record<string, string>)['X-Smtp2go-Api-Key']).toBe('k');
		expect(JSON.parse(init.body as string)).toEqual({
			sender: 'PM <a@x.com>', to: ['to@example.com'], subject: 'S', text_body: 'T'
		});
	});

	it('resend: Bearer トークンで JSON を POST する', async () => {
		const f = okFetch();
		await createMailer({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' }, f).send(msg);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
		expect(JSON.parse(init.body as string)).toEqual({
			from: 'a@x.com', to: ['to@example.com'], subject: 'S', text: 'T'
		});
	});

	it('API がエラーを返したら例外にする', async () => {
		const f = vi.fn(async () => new Response('bad', { status: 401 })) as unknown as typeof fetch;
		await expect(
			createMailer({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' }, f).send(msg)
		).rejects.toThrow('401');
	});

	it('console 以外で API キーか送信元が無ければ作成時に例外', () => {
		expect(() => createMailer({ MAIL_PROVIDER: 'smtp2go' })).toThrow('MAIL_API_KEY');
	});

	it('console は fetch しない', async () => {
		const f = okFetch();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await createMailer({ MAIL_PROVIDER: 'console' }, f).send(msg);
		expect(f).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});
});
```

Run: `pnpm test:unit --run src/lib/server/mailer`
Expected: FAIL（`createMailer` が無い）

- [ ] **Step 2: mailer とテンプレートを実装する**

`apps/web/src/lib/server/mailer/index.ts` を次に置き換える:
```ts
export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface Mailer {
	send(msg: MailMessage): Promise<void>;
}

export interface MailEnv {
	MAIL_PROVIDER: 'smtp2go' | 'resend' | 'console';
	MAIL_API_KEY?: string;
	MAIL_FROM?: string;
}

async function postJson(
	fetchFn: typeof fetch,
	url: string,
	headers: Record<string, string>,
	body: unknown
): Promise<void> {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`mail API ${url} failed: ${res.status} ${await res.text()}`);
}

export function createMailer(env: MailEnv, fetchFn: typeof fetch = fetch): Mailer {
	if (env.MAIL_PROVIDER === 'console') {
		return {
			async send(m) {
				console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`);
			}
		};
	}
	const { MAIL_API_KEY: key, MAIL_FROM: from } = env;
	if (!key || !from) throw new Error('MAIL_API_KEY and MAIL_FROM are required when MAIL_PROVIDER is not console');

	if (env.MAIL_PROVIDER === 'smtp2go') {
		return {
			send: (m) =>
				postJson(fetchFn, 'https://api.smtp2go.com/v3/email/send', { 'X-Smtp2go-Api-Key': key }, {
					sender: from,
					to: [m.to],
					subject: m.subject,
					text_body: m.text,
					...(m.html ? { html_body: m.html } : {})
				})
		};
	}
	return {
		send: (m) =>
			postJson(fetchFn, 'https://api.resend.com/emails', { Authorization: `Bearer ${key}` }, {
				from,
				to: [m.to],
				subject: m.subject,
				text: m.text,
				...(m.html ? { html: m.html } : {})
			})
	};
}
```

`apps/web/src/lib/server/mailer/templates.ts`:
```ts
export function invitationMail(p: { url: string; inviterName: string; projectName: string | null }) {
	const where = p.projectName ? `「${p.projectName}」` : 'Project Manager';
	const whereEn = p.projectName ? `"${p.projectName}"` : 'Project Manager';
	return {
		subject: `${where}に招待されました / You are invited to ${whereEn}`,
		text: [
			`${p.inviterName} さんから${where}に招待されました。`,
			'次のリンクを開き、名前とパスワードを設定してください（有効期限 7 日）。',
			p.url,
			'',
			'---',
			'',
			`${p.inviterName} invited you to ${whereEn}.`,
			'Open the link below to set your name and password (expires in 7 days).',
			p.url
		].join('\n')
	};
}

export function resetPasswordMail(p: { url: string }) {
	return {
		subject: 'パスワードの再設定 / Reset your password',
		text: [
			'次のリンクからパスワードを再設定してください（有効期限 1 時間）。',
			'心当たりがない場合はこのメールを無視してください。',
			p.url,
			'',
			'---',
			'',
			'Use the link below to reset your password (expires in 1 hour).',
			'If you did not request this, you can ignore this email.',
			p.url
		].join('\n')
	};
}
```

Run: `pnpm test:unit --run src/lib/server/mailer`
Expected: PASS

- [ ] **Step 3: 失敗するテストを書く（markdown / ratelimit / redirect）**

`apps/web/src/lib/server/markdown.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
	it('生の HTML はエスケープする', () => {
		const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
	});
	it('javascript: リンクはリンクにしない', () => {
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript:');
	});
	it('リンクには rel と target を付ける', () => {
		const html = renderMarkdown('[x](https://example.com)');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
		expect(html).toContain('target="_blank"');
	});
	it('URL を自動リンクする', () => {
		expect(renderMarkdown('see https://example.com')).toContain('<a href="https://example.com"');
	});
});
```

`apps/web/src/lib/server/ratelimit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { consumeRateLimit } from './ratelimit';
import { createTestDb } from './test-utils';

describe('consumeRateLimit', () => {
	it('窓の中で max 回までは許可し、それを超えたら拒否、窓が過ぎたらリセット', async () => {
		const db = await createTestDb();
		const limit = { windowMs: 1000, max: 2 };
		expect(await consumeRateLimit(db, 'k', limit, 0)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 10)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 20)).toBe(false);
		expect(await consumeRateLimit(db, 'other', limit, 20)).toBe(true);
		expect(await consumeRateLimit(db, 'k', limit, 1001)).toBe(true);
	});
});
```

`apps/web/src/lib/server/redirect.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
	it.each([
		['/projects/ACME?x=1', '/projects/ACME?x=1'],
		[null, '/'],
		['', '/'],
		['https://evil.example', '/'],
		['//evil.example', '/'],
		['/\\evil.example', '/'],
		['javascript:alert(1)', '/']
	])('%s → %s', (input, expected) => {
		expect(safeRedirect(input)).toBe(expected);
	});
});
```

Run: `pnpm test:unit --run src/lib/server`
Expected: 3 ファイルが FAIL

- [ ] **Step 4: 実装する**

`apps/web/src/lib/server/markdown.ts`:
```ts
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx].attrSet('rel', 'noopener noreferrer nofollow');
	tokens[idx].attrSet('target', '_blank');
	return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(src: string): string {
	return md.render(src);
}
```

`apps/web/src/lib/server/ratelimit.ts`:
```ts
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { DB } from './db';
import { rateLimit } from './db/schema';

export interface Limit {
	windowMs: number;
	max: number;
}

export const LOGIN_LIMIT: Limit = { windowMs: 60_000, max: 5 };
export const RESET_LIMIT: Limit = { windowMs: 15 * 60_000, max: 3 };
export const SIGNUP_LIMIT: Limit = { windowMs: 15 * 60_000, max: 10 };

/** 固定窓のレート制限。キーは better-auth と衝突しないよう呼び出し側で `app:` を付ける。lastRequest は窓の開始時刻。 */
export async function consumeRateLimit(
	db: DB,
	key: string,
	limit: Limit,
	now: number = Date.now()
): Promise<boolean> {
	const [row] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
	if (!row || now - row.lastRequest >= limit.windowMs) {
		await db
			.insert(rateLimit)
			.values({ id: uuidv7(), key, count: 1, lastRequest: now })
			.onConflictDoUpdate({ target: rateLimit.key, set: { count: 1, lastRequest: now } });
		return true;
	}
	if (row.count >= limit.max) return false;
	await db.update(rateLimit).set({ count: row.count + 1 }).where(eq(rateLimit.key, key));
	return true;
}
```

`apps/web/src/lib/server/redirect.ts`:
```ts
export function safeRedirect(target: string | null, fallback = '/'): string {
	if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
		return fallback;
	}
	return target;
}
```

Run: `pnpm test:unit --run src/lib/server && pnpm check`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): add mailer, markdown rendering, rate limit and safe redirect"
```

---

### Task 5: 初期セットアップと招待（services）

**Files:**
- Create: `apps/web/src/lib/server/services/credentials.ts`, `setup.ts`, `invitations.ts`
- Test: `apps/web/src/lib/server/services/setup.test.ts`, `invitations.test.ts`

**Interfaces:**
- Consumes: `BaseContext`, `AppContext`, `authorize`, `parse`, `EmailSchema`, `NameSchema`, `PasswordSchema`, `randomToken`, `sha256Hex`, `invitationMail`, `Tx`
- Produces:
  - `insertCredentialUser(tx: Tx, input: { name: string; email: string; role: Role; passwordHash: string }): Promise<string>`
  - `needsSetup(db: DB): Promise<boolean>`, `createFirstAdmin(base: BaseContext, input: unknown): Promise<{ email: string }>`
  - `createInvitation(ctx: AppContext, input: unknown, opts?: { sendMail?: boolean }): Promise<{ url: string }>`
  - `reissueInvitation(ctx: AppContext, invitationId: string): Promise<{ url: string }>`
  - `revokeInvitation(ctx: AppContext, invitationId: string): Promise<void>`
  - `listPendingInvitations(ctx: AppContext, filter?: { projectId?: string }): Promise<PendingInvitation[]>`（`{ id, email, role, projectId, projectName, expiresAt, expired }`）
  - `getInvitationByToken(db: DB, token: string): Promise<{ email: string; role: 'member' | 'guest'; projectName: string | null } | null>`
  - `acceptInvitation(base: BaseContext, input: unknown): Promise<{ email: string }>`（input = `{ token, name, password }`）

- [ ] **Step 1: 失敗するテストを書く（setup）**

`apps/web/src/lib/server/services/setup.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { account, user } from '../db/schema';
import { createTestBase, createTestDb } from '../test-utils';
import { createFirstAdmin, needsSetup } from './setup';

const input = { name: '管理者', email: 'Admin@Example.com', password: 'password-1234' };

describe('setup', () => {
	it('ユーザーが 0 人なら admin を作り、credential アカウントにハッシュを保存する', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		expect(await needsSetup(db)).toBe(true);

		expect(await createFirstAdmin(base, input)).toEqual({ email: 'admin@example.com' });

		const [u] = await db.select().from(user);
		expect(u.role).toBe('admin');
		expect(u.emailVerified).toBe(true);
		const [a] = await db.select().from(account);
		expect(a).toMatchObject({ providerId: 'credential', accountId: u.id, password: 'test-hash:password-1234' });
		expect(await needsSetup(db)).toBe(false);
	});

	it('2 回目は conflict', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		await createFirstAdmin(base, input);
		await expect(createFirstAdmin(base, { ...input, email: 'b@example.com' })).rejects.toMatchObject({
			code: 'conflict'
		});
	});

	it('短いパスワードは validation', async () => {
		const db = await createTestDb();
		await expect(createFirstAdmin(createTestBase(db), { ...input, password: 'short' })).rejects.toMatchObject({
			code: 'validation'
		});
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/setup.test.ts`
Expected: FAIL

- [ ] **Step 2: credentials.ts と setup.ts を実装する**

`apps/web/src/lib/server/services/credentials.ts`:
```ts
import { uuidv7 } from 'uuidv7';
import type { Role } from '../authz';
import type { Tx } from '../db';
import { account, user } from '../db/schema';

/** better-auth の signUpEmail と同じ形で user と credential account を作る。トランザクション内で呼ぶこと。 */
export async function insertCredentialUser(
	tx: Tx,
	input: { name: string; email: string; role: Role; passwordHash: string }
): Promise<string> {
	const id = uuidv7();
	await tx.insert(user).values({
		id,
		name: input.name,
		email: input.email,
		role: input.role,
		emailVerified: true
	});
	await tx.insert(account).values({
		id: uuidv7(),
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: input.passwordHash
	});
	return id;
}
```

`apps/web/src/lib/server/services/setup.ts`:
```ts
import { count } from 'drizzle-orm';
import * as v from 'valibot';
import type { BaseContext } from '../context';
import type { DB } from '../db';
import { user } from '../db/schema';
import { AppError } from '../errors';
import { EmailSchema, NameSchema, parse, PasswordSchema } from '../validation';
import { insertCredentialUser } from './credentials';

export async function needsSetup(db: DB): Promise<boolean> {
	const [row] = await db.select({ n: count() }).from(user);
	return row.n === 0;
}

const SetupInput = v.object({ name: NameSchema, email: EmailSchema, password: PasswordSchema });

export async function createFirstAdmin(base: BaseContext, input: unknown): Promise<{ email: string }> {
	const data = parse(SetupInput, input);
	const passwordHash = await base.hashPassword(data.password);
	await base.db.transaction(async (tx) => {
		const [row] = await tx.select({ n: count() }).from(user);
		if (row.n > 0) throw new AppError('conflict', 'セットアップは既に完了しています');
		await insertCredentialUser(tx, { name: data.name, email: data.email, role: 'admin', passwordHash });
	});
	return { email: data.email };
}
```

Run: `pnpm test:unit --run src/lib/server/services/setup.test.ts`
Expected: PASS

- [ ] **Step 3: 失敗するテストを書く（invitations）**

`apps/web/src/lib/server/services/invitations.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { invitation, projectMember, user } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	acceptInvitation,
	createInvitation,
	getInvitationByToken,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from './invitations';

const tokenOf = (url: string) => url.split('/invite/')[1];

describe('invitations', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor;
	let projectId: string;

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理者');
		({ id: projectId } = await seedProject(db, { name: 'Acme' }));
	});

	it('admin 以外は招待できない', async () => {
		const member = await seedUser(db, 'member');
		await expect(
			createInvitation(ctxOf(base, member), { email: 'x@example.com', role: 'member' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('招待するとリンクを返し、メールを送り、DB にはハッシュだけ保存する', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'Guest@Example.com', role: 'guest', projectId
		});
		expect(url).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/);
		expect(base.sent).toHaveLength(1);
		expect(base.sent[0].to).toBe('guest@example.com');
		expect(base.sent[0].text).toContain(url);
		const [row] = await db.select().from(invitation);
		expect(row.tokenHash).not.toBe(tokenOf(url));
		expect(await getInvitationByToken(db, tokenOf(url))).toEqual({
			email: 'guest@example.com', role: 'guest', projectName: 'Acme'
		});
	});

	it('ゲストの招待にはプロジェクトが必須', async () => {
		await expect(
			createInvitation(ctxOf(base, admin), { email: 'g@example.com', role: 'guest' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('登録済みのメールアドレスは conflict', async () => {
		await expect(
			createInvitation(ctxOf(base, admin), { email: admin.email, role: 'member' })
		).rejects.toMatchObject({ code: 'conflict' });
	});

	it('受諾するとユーザーを作り、プロジェクトに参加させ、リンクは再利用できない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'guest@example.com', role: 'guest', projectId
		});
		const input = { token: tokenOf(url), name: '顧客', password: 'password-1234' };

		expect(await acceptInvitation(base, input)).toEqual({ email: 'guest@example.com' });

		const [u] = await db.select().from(user).where(eq(user.email, 'guest@example.com'));
		expect(u.role).toBe('guest');
		expect(await db.select().from(projectMember).where(eq(projectMember.userId, u.id))).toHaveLength(1);
		await expect(acceptInvitation(base, input)).rejects.toMatchObject({ code: 'not_found' });
		expect(await getInvitationByToken(db, tokenOf(url))).toBeNull();
	});

	it('期限切れのリンクは使えない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), { email: 'm@example.com', role: 'member' });
		await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) });
		expect(await getInvitationByToken(db, tokenOf(url))).toBeNull();
		await expect(
			acceptInvitation(base, { token: tokenOf(url), name: 'M', password: 'password-1234' })
		).rejects.toMatchObject({ code: 'not_found' });
		expect(await db.select().from(user)).toHaveLength(1);
	});

	it('再発行すると古いリンクは無効になり、メールは送らない', async () => {
		const ctx = ctxOf(base, admin);
		const { url: oldUrl } = await createInvitation(ctx, { email: 'm@example.com', role: 'member' });
		const [pending] = await listPendingInvitations(ctx);
		const { url: newUrl } = await reissueInvitation(ctx, pending.id);

		expect(newUrl).not.toBe(oldUrl);
		expect(await getInvitationByToken(db, tokenOf(oldUrl))).toBeNull();
		expect(await getInvitationByToken(db, tokenOf(newUrl))).not.toBeNull();
		expect(base.sent).toHaveLength(1);
		expect(await listPendingInvitations(ctx)).toHaveLength(1);
	});

	it('取り消すと一覧から消える', async () => {
		const ctx = ctxOf(base, admin);
		await createInvitation(ctx, { email: 'm@example.com', role: 'member' });
		const [pending] = await listPendingInvitations(ctx);
		await revokeInvitation(ctx, pending.id);
		expect(await listPendingInvitations(ctx)).toHaveLength(0);
	});

	it('プロジェクトで絞り込める', async () => {
		const ctx = ctxOf(base, admin);
		await createInvitation(ctx, { email: 'g@example.com', role: 'guest', projectId });
		await createInvitation(ctx, { email: 'm@example.com', role: 'member' });
		const list = await listPendingInvitations(ctx, { projectId });
		expect(list.map((i) => i.email)).toEqual(['g@example.com']);
		expect(list[0]).toMatchObject({ projectName: 'Acme', expired: false });
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/invitations.test.ts`
Expected: FAIL

- [ ] **Step 4: invitations.ts を実装する**

`apps/web/src/lib/server/services/invitations.ts`:
```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext, BaseContext } from '../context';
import type { DB } from '../db';
import { invitation, project, projectMember, user } from '../db/schema';
import { AppError } from '../errors';
import { invitationMail } from '../mailer/templates';
import { randomToken, sha256Hex } from '../tokens';
import { EmailSchema, NameSchema, parse, PasswordSchema } from '../validation';
import { insertCredentialUser } from './credentials';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITE = '招待リンクが無効か、期限切れです。管理者に再発行を依頼してください';

const CreateInput = v.object({
	email: EmailSchema,
	role: v.picklist(['member', 'guest'], 'ロールを選択してください'),
	projectId: v.optional(v.string())
});

export async function createInvitation(
	ctx: AppContext,
	input: unknown,
	opts: { sendMail?: boolean } = {}
): Promise<{ url: string }> {
	authorize(ctx.actor, 'user:manage');
	const data = parse(CreateInput, input);
	const projectId = data.projectId || null;
	if (data.role === 'guest' && !projectId) {
		throw new AppError('validation', 'ゲストを招待するにはプロジェクトを選択してください', {
			projectId: ['プロジェクトを選択してください']
		});
	}
	let projectName: string | null = null;
	if (projectId) {
		const [p] = await ctx.db.select({ name: project.name }).from(project).where(eq(project.id, projectId));
		if (!p) throw new AppError('validation', 'プロジェクトが見つかりません', { projectId: ['プロジェクトが見つかりません'] });
		projectName = p.name;
	}
	const [existing] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, data.email));
	if (existing) throw new AppError('conflict', 'このメールアドレスのユーザーは既に登録されています');

	const token = randomToken();
	await ctx.db.batch([
		ctx.db
			.delete(invitation)
			.where(and(eq(invitation.email, data.email), isNull(invitation.acceptedAt))),
		ctx.db.insert(invitation).values({
			id: uuidv7(),
			email: data.email,
			role: data.role,
			projectId,
			tokenHash: await sha256Hex(token),
			invitedBy: ctx.actor.id,
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		})
	]);

	const url = `${ctx.baseUrl}/invite/${token}`;
	if (opts.sendMail ?? true) {
		ctx.waitUntil(
			ctx.mailer
				.send({ to: data.email, ...invitationMail({ url, inviterName: ctx.actor.name, projectName }) })
				.catch((e) => console.error('invitation mail failed', e))
		);
	}
	return { url };
}

async function findPending(ctx: AppContext, invitationId: string) {
	const [row] = await ctx.db
		.select()
		.from(invitation)
		.where(and(eq(invitation.id, invitationId), isNull(invitation.acceptedAt)));
	if (!row) throw new AppError('not_found', '招待が見つかりません');
	return row;
}

export async function reissueInvitation(ctx: AppContext, invitationId: string): Promise<{ url: string }> {
	authorize(ctx.actor, 'user:manage');
	const row = await findPending(ctx, invitationId);
	return createInvitation(
		ctx,
		{ email: row.email, role: row.role, projectId: row.projectId ?? undefined },
		{ sendMail: false }
	);
}

export async function revokeInvitation(ctx: AppContext, invitationId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	await findPending(ctx, invitationId);
	await ctx.db.delete(invitation).where(eq(invitation.id, invitationId));
}

export interface PendingInvitation {
	id: string;
	email: string;
	role: 'member' | 'guest';
	projectId: string | null;
	projectName: string | null;
	expiresAt: Date;
	expired: boolean;
}

export async function listPendingInvitations(
	ctx: AppContext,
	filter: { projectId?: string } = {}
): Promise<PendingInvitation[]> {
	authorize(ctx.actor, 'user:manage');
	const conds = [isNull(invitation.acceptedAt)];
	if (filter.projectId) conds.push(eq(invitation.projectId, filter.projectId));
	const rows = await ctx.db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			projectId: invitation.projectId,
			projectName: project.name,
			expiresAt: invitation.expiresAt
		})
		.from(invitation)
		.leftJoin(project, eq(invitation.projectId, project.id))
		.where(and(...conds))
		.orderBy(desc(invitation.createdAt));
	const now = Date.now();
	return rows.map((r) => ({ ...r, expired: r.expiresAt.getTime() < now }));
}

async function findValidByToken(db: DB, token: string) {
	const [row] = await db
		.select()
		.from(invitation)
		.where(eq(invitation.tokenHash, await sha256Hex(token)));
	if (!row || row.acceptedAt || row.expiresAt.getTime() < Date.now()) return null;
	return row;
}

export async function getInvitationByToken(db: DB, token: string) {
	const row = await findValidByToken(db, token);
	if (!row) return null;
	let projectName: string | null = null;
	if (row.projectId) {
		const [p] = await db.select({ name: project.name }).from(project).where(eq(project.id, row.projectId));
		projectName = p?.name ?? null;
	}
	return { email: row.email, role: row.role, projectName };
}

const AcceptInput = v.object({ token: v.string(), name: NameSchema, password: PasswordSchema });

export async function acceptInvitation(base: BaseContext, input: unknown): Promise<{ email: string }> {
	const data = parse(AcceptInput, input);
	const inv = await findValidByToken(base.db, data.token);
	if (!inv) throw new AppError('not_found', INVALID_INVITE);
	const passwordHash = await base.hashPassword(data.password);

	await base.db.transaction(async (tx) => {
		const claimed = await tx
			.update(invitation)
			.set({ acceptedAt: new Date() })
			.where(and(eq(invitation.id, inv.id), isNull(invitation.acceptedAt)))
			.returning({ id: invitation.id });
		if (claimed.length === 0) throw new AppError('not_found', INVALID_INVITE);
		const [dup] = await tx.select({ id: user.id }).from(user).where(eq(user.email, inv.email));
		if (dup) throw new AppError('conflict', 'このメールアドレスのユーザーは既に登録されています');
		const userId = await insertCredentialUser(tx, {
			name: data.name,
			email: inv.email,
			role: inv.role,
			passwordHash
		});
		if (inv.projectId) await tx.insert(projectMember).values({ projectId: inv.projectId, userId });
	});
	return { email: inv.email };
}
```

Run: `pnpm test:unit --run src/lib/server/services && pnpm check`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(services): add first-run setup and invitation flow"
```

---

### Task 6: ユーザー管理とプロジェクト（services）

**Files:**
- Create: `apps/web/src/lib/server/services/users.ts`, `projects.ts`
- Test: `apps/web/src/lib/server/services/users.test.ts`, `projects.test.ts`

**Interfaces:**
- Consumes: Task 3〜5
- Produces:
  - `listUsers(ctx): Promise<{ id; name; email; role; disabledAt: Date | null; createdAt: Date }[]>`
  - `disableUser(ctx, userId: string): Promise<void>`（セッションも削除）
  - `isDisabledEmail(db: DB, email: string): Promise<boolean>`
  - `type ProjectRow = typeof project.$inferSelect`
  - `listProjects(ctx): Promise<ProjectRow[]>`
  - `requireProject(ctx, key: string): Promise<ProjectRow>`、`assertWritable(p: ProjectRow): void`
  - `createProject(ctx, input: unknown): Promise<{ key: string }>`、`updateProject(ctx, key, input: unknown): Promise<void>`、`setProjectArchived(ctx, key, archived: boolean): Promise<void>`
  - `listMembers(ctx, key): Promise<{ id; name; email; role }[]>`、`addMember(ctx, key, userId): Promise<void>`、`removeMember(ctx, key, userId): Promise<void>`
  - `listAssignableUsers(db: DB, projectId: string): Promise<{ id; name; role }[]>`、`assertAssignable(db, projectId, userId): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く（users）**

`apps/web/src/lib/server/services/users.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { session } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedUser } from '../test-utils';
import { disableUser, isDisabledEmail, listUsers } from './users';

describe('users', () => {
	it('無効化するとセッションが消え、ログイン拒否の判定が true になる', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin');
		const guest = await seedUser(db, 'guest');
		await db.insert(session).values({
			id: 's1', token: 't1', userId: guest.id, expiresAt: new Date(Date.now() + 60_000)
		});

		await disableUser(ctxOf(base, admin), guest.id);

		expect(await db.select().from(session)).toHaveLength(0);
		expect(await isDisabledEmail(db, guest.email)).toBe(true);
		expect(await isDisabledEmail(db, admin.email)).toBe(false);
		expect(await isDisabledEmail(db, 'nobody@example.com')).toBe(false);
	});

	it('自分自身は無効化できない / admin 以外は操作できない', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin');
		const member = await seedUser(db, 'member');
		await expect(disableUser(ctxOf(base, admin), admin.id)).rejects.toMatchObject({ code: 'validation' });
		await expect(disableUser(ctxOf(base, member), admin.id)).rejects.toMatchObject({ code: 'forbidden' });
		await expect(listUsers(ctxOf(base, member))).rejects.toMatchObject({ code: 'forbidden' });
		expect(await listUsers(ctxOf(base, admin))).toHaveLength(2);
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/users.test.ts`
Expected: FAIL

- [ ] **Step 2: users.ts を実装する**

`apps/web/src/lib/server/services/users.ts`:
```ts
import { asc, eq } from 'drizzle-orm';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { session, user } from '../db/schema';
import { AppError } from '../errors';

export async function listUsers(ctx: AppContext) {
	authorize(ctx.actor, 'user:manage');
	return ctx.db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			disabledAt: user.disabledAt,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(asc(user.createdAt));
}

export async function disableUser(ctx: AppContext, userId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	if (userId === ctx.actor.id) throw new AppError('validation', '自分自身は無効化できません');
	const updated = await ctx.db
		.update(user)
		.set({ disabledAt: new Date() })
		.where(eq(user.id, userId))
		.returning({ id: user.id });
	if (updated.length === 0) throw new AppError('not_found', 'ユーザーが見つかりません');
	await ctx.db.delete(session).where(eq(session.userId, userId));
}

export async function isDisabledEmail(db: DB, email: string): Promise<boolean> {
	const [row] = await db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.email, email));
	return !!row?.disabledAt;
}
```

Run: `pnpm test:unit --run src/lib/server/services/users.test.ts`
Expected: PASS

- [ ] **Step 3: 失敗するテストを書く（projects）**

`apps/web/src/lib/server/services/projects.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	addMember,
	assertWritable,
	createProject,
	listAssignableUsers,
	listMembers,
	listProjects,
	removeMember,
	requireProject,
	setProjectArchived,
	updateProject
} from './projects';

describe('projects', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
	});

	it('admin はキーを大文字にしてプロジェクトを作れる。重複キーは conflict', async () => {
		expect(await createProject(ctxOf(base, admin), { key: 'acme', name: 'Acme', description: '' })).toEqual({ key: 'ACME' });
		await expect(createProject(ctxOf(base, admin), { key: 'ACME', name: 'X', description: '' })).rejects.toMatchObject({ code: 'conflict' });
		await expect(createProject(ctxOf(base, admin), { key: '1BAD', name: 'X', description: '' })).rejects.toMatchObject({ code: 'validation' });
		await expect(createProject(ctxOf(base, member), { key: 'NEW', name: 'X', description: '' })).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('参加していないプロジェクトは一覧に出ず、開くと not_found', async () => {
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'OTHER' });
		expect((await listProjects(ctxOf(base, admin))).map((p) => p.key).sort()).toEqual(['ACME', 'OTHER']);
		expect((await listProjects(ctxOf(base, guest))).map((p) => p.key)).toEqual(['ACME']);
		await expect(requireProject(ctxOf(base, guest), 'OTHER')).rejects.toMatchObject({ code: 'not_found' });
		await expect(requireProject(ctxOf(base, outsider), 'ACME')).rejects.toMatchObject({ code: 'not_found' });
		expect((await requireProject(ctxOf(base, admin), 'OTHER')).key).toBe('OTHER');
	});

	it('アーカイブすると書き込み不可', async () => {
		await seedProject(db, { key: 'ACME' });
		await setProjectArchived(ctxOf(base, admin), 'ACME', true);
		const p = await requireProject(ctxOf(base, admin), 'ACME');
		expect(() => assertWritable(p)).toThrow();
		await setProjectArchived(ctxOf(base, admin), 'ACME', false);
		expect(() => assertWritable(p)).toThrow(); // 取得済みの行は古いまま
		expect(() => assertWritable(await requireProject(ctxOf(base, admin), 'ACME'))).not.toThrow();
	});

	it('名前と説明を更新できる', async () => {
		await seedProject(db, { key: 'ACME' });
		await updateProject(ctxOf(base, admin), 'ACME', { name: '新名称', description: '説明' });
		expect(await requireProject(ctxOf(base, admin), 'ACME')).toMatchObject({ name: '新名称', description: '説明' });
	});

	it('参加者の追加・削除。削除するとそのプロジェクトの担当が外れる', async () => {
		const { id } = await seedProject(db, { key: 'ACME', members: [member] });
		await addMember(ctxOf(base, admin), 'ACME', guest.id);
		await addMember(ctxOf(base, admin), 'ACME', guest.id); // 2 回目は何もしない
		expect((await listMembers(ctxOf(base, admin), 'ACME')).map((m) => m.id).sort()).toEqual([member.id, guest.id].sort());
		await expect(addMember(ctxOf(base, admin), 'ACME', admin.id)).rejects.toMatchObject({ code: 'validation' });

		await db.insert(issue).values({ id: 'i1', projectId: id, number: 1, title: 't', reporterId: member.id, assigneeId: guest.id, position: 'a0' });
		await removeMember(ctxOf(base, admin), 'ACME', guest.id);
		expect((await listMembers(ctxOf(base, admin), 'ACME')).map((m) => m.id)).toEqual([member.id]);
		const [i] = await db.select().from(issue).where(eq(issue.id, 'i1'));
		expect(i.assigneeId).toBeNull();
	});

	it('担当者候補は参加者（ゲスト含む）と admin。無効化ユーザーは除く', async () => {
		const { id } = await seedProject(db, { key: 'ACME', members: [member, guest] });
		const ids = (await listAssignableUsers(db, id)).map((u) => u.id).sort();
		expect(ids).toEqual([admin.id, member.id, guest.id].sort());
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/projects.test.ts`
Expected: FAIL

- [ ] **Step 4: projects.ts を実装する**

`apps/web/src/lib/server/services/projects.ts`:
```ts
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { issue, project, projectMember, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';

export type ProjectRow = typeof project.$inferSelect;

const KeySchema = v.pipe(
	v.string(),
	v.trim(),
	v.toUpperCase(),
	v.regex(/^[A-Z][A-Z0-9]{1,9}$/, 'キーは英字で始まる2〜10文字の英数字で入力してください')
);
const ProjectNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'プロジェクト名を入力してください'),
	v.maxLength(100, 'プロジェクト名は100文字以内で入力してください')
);
const DescriptionSchema = v.optional(v.pipe(v.string(), v.maxLength(10_000)), '');

export async function listProjects(ctx: AppContext): Promise<ProjectRow[]> {
	if (ctx.actor.role === 'admin') {
		return ctx.db.select().from(project).orderBy(asc(project.name));
	}
	const rows = await ctx.db
		.select({ project })
		.from(project)
		.innerJoin(projectMember, eq(projectMember.projectId, project.id))
		.where(eq(projectMember.userId, ctx.actor.id))
		.orderBy(asc(project.name));
	return rows.map((r) => r.project);
}

export async function requireProject(ctx: AppContext, key: string): Promise<ProjectRow> {
	const [p] = await ctx.db.select().from(project).where(eq(project.key, key));
	if (!p) throw new AppError('not_found', 'プロジェクトが見つかりません');
	if (ctx.actor.role !== 'admin') {
		const [m] = await ctx.db
			.select({ userId: projectMember.userId })
			.from(projectMember)
			.where(and(eq(projectMember.projectId, p.id), eq(projectMember.userId, ctx.actor.id)));
		if (!m) throw new AppError('not_found', 'プロジェクトが見つかりません');
	}
	return p;
}

export function assertWritable(p: ProjectRow): void {
	if (p.archivedAt) throw new AppError('conflict', 'アーカイブ済みのプロジェクトは変更できません');
}

export async function createProject(ctx: AppContext, input: unknown): Promise<{ key: string }> {
	authorize(ctx.actor, 'project:manage');
	const data = parse(
		v.object({ key: KeySchema, name: ProjectNameSchema, description: DescriptionSchema }),
		input
	);
	const [dup] = await ctx.db.select({ id: project.id }).from(project).where(eq(project.key, data.key));
	if (dup) throw new AppError('conflict', 'このキーは既に使われています', { key: ['このキーは既に使われています'] });
	await ctx.db.insert(project).values({ id: uuidv7(), ...data });
	return { key: data.key };
}

export async function updateProject(ctx: AppContext, key: string, input: unknown): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	const data = parse(v.object({ name: ProjectNameSchema, description: DescriptionSchema }), input);
	await ctx.db.update(project).set(data).where(eq(project.id, p.id));
}

export async function setProjectArchived(ctx: AppContext, key: string, archived: boolean): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	await ctx.db
		.update(project)
		.set({ archivedAt: archived ? new Date() : null })
		.where(eq(project.id, p.id));
}

export async function listMembers(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select({ id: user.id, name: user.name, email: user.email, role: user.role })
		.from(projectMember)
		.innerJoin(user, eq(user.id, projectMember.userId))
		.where(eq(projectMember.projectId, p.id))
		.orderBy(asc(user.name));
}

export async function addMember(ctx: AppContext, key: string, userId: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	const [u] = await ctx.db.select().from(user).where(eq(user.id, userId));
	if (!u || u.disabledAt || u.role === 'admin') {
		throw new AppError('validation', '追加できないユーザーです（管理者は全プロジェクトに参加済みです）');
	}
	await ctx.db.insert(projectMember).values({ projectId: p.id, userId }).onConflictDoNothing();
}

export async function removeMember(ctx: AppContext, key: string, userId: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	await ctx.db.batch([
		ctx.db
			.delete(projectMember)
			.where(and(eq(projectMember.projectId, p.id), eq(projectMember.userId, userId))),
		ctx.db
			.update(issue)
			.set({ assigneeId: null })
			.where(and(eq(issue.projectId, p.id), eq(issue.assigneeId, userId)))
	]);
}

export async function listAssignableUsers(db: DB, projectId: string) {
	return db
		.select({ id: user.id, name: user.name, role: user.role })
		.from(user)
		.where(
			and(
				isNull(user.disabledAt),
				or(
					eq(user.role, 'admin'),
					inArray(
						user.id,
						db
							.select({ id: projectMember.userId })
							.from(projectMember)
							.where(eq(projectMember.projectId, projectId))
					)
				)
			)
		)
		.orderBy(asc(user.name));
}

export async function assertAssignable(db: DB, projectId: string, userId: string): Promise<void> {
	const users = await listAssignableUsers(db, projectId);
	if (!users.some((u) => u.id === userId)) {
		throw new AppError('validation', 'このユーザーは担当者にできません', {
			assigneeId: ['このユーザーは担当者にできません']
		});
	}
}
```

Run: `pnpm test:unit --run src/lib/server/services && pnpm check`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(services): add user management and projects with membership"
```

---

### Task 7: 課題とコメント（services）

**Files:**
- Create: `apps/web/src/lib/server/services/issues.ts`, `comments.ts`
- Test: `apps/web/src/lib/server/services/issues.test.ts`, `comments.test.ts`

**Interfaces:**
- Consumes: `requireProject`, `assertWritable`, `assertAssignable`, `authorize`, `parse`, `emptyToNull`
- Produces:
  - `interface IssueFilters { status?: Status; assigneeId?: string; priority?: Priority }`（`assigneeId: 'none'` は未割り当て）
  - `type IssueListItem = { id; number; title; status; priority; dueDate; position; assigneeId; assigneeName: string | null; reporterId; updatedAt }`
  - `listIssues(ctx, key, filters?): Promise<IssueListItem[]>`（番号の降順）
  - `listBoard(ctx, key): Promise<Record<Status, IssueListItem[]>>`（position 昇順）
  - `getIssue(ctx, key, number): Promise<{ project: ProjectRow; issue: IssueDetail }>`（`IssueDetail = typeof issue.$inferSelect & { assigneeName: string | null; reporterName: string }`）
  - `createIssue(ctx, key, input): Promise<{ number: number }>`、`updateIssue(ctx, key, number, input): Promise<void>`、`moveIssue(ctx, key, input): Promise<void>`、`deleteIssue(ctx, key, number): Promise<void>`
  - `listComments(ctx, key, number): Promise<{ id; body; authorId; authorName; createdAt; updatedAt }[]>`、`addComment(ctx, key, number, input)`、`editComment(ctx, key, number, commentId, input)`、`deleteComment(ctx, key, number, commentId)`

- [ ] **Step 1: 失敗するテストを書く（issues）**

`apps/web/src/lib/server/services/issues.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { createIssue, deleteIssue, getIssue, listBoard, listIssues, moveIssue, updateIssue } from './issues';

describe('issues', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, guest2: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		guest2 = await seedUser(db, 'guest', 'guest2');
		await seedProject(db, { key: 'ACME', members: [member, guest, guest2] });
	});

	it('起票すると連番が振られ、todo の末尾に入る', async () => {
		expect(await createIssue(as(guest), 'ACME', { title: 'A' })).toEqual({ number: 1 });
		expect(await createIssue(as(member), 'ACME', { title: 'B', priority: 'high', dueDate: '2026-12-31' })).toEqual({ number: 2 });
		const board = await listBoard(as(member), 'ACME');
		expect(board.todo.map((i) => i.number)).toEqual([1, 2]);
		const { issue } = await getIssue(as(member), 'ACME', 2);
		expect(issue).toMatchObject({ priority: 'high', dueDate: '2026-12-31', status: 'todo', reporterId: member.id });
	});

	it('同時に起票しても番号が重複しない', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) => createIssue(as(member), 'ACME', { title: `T${i}` }))
		);
		expect(results.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('ゲストは起票時に担当者を指定できない', async () => {
		await expect(createIssue(as(guest), 'ACME', { title: 'A', assigneeId: member.id })).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('参加者でない人は担当者にできない', async () => {
		const outsider = await seedUser(db, 'member', 'outsider');
		await expect(createIssue(as(member), 'ACME', { title: 'A', assigneeId: outsider.id })).rejects.toMatchObject({ code: 'validation' });
	});

	it('ゲストは自分が起票した課題だけ内容を編集できる', async () => {
		await createIssue(as(guest), 'ACME', { title: 'mine' });
		await createIssue(as(member), 'ACME', { title: 'theirs' });
		await updateIssue(as(guest), 'ACME', 1, { title: 'mine2', description: 'd', priority: 'low', dueDate: '' });
		expect((await getIssue(as(guest), 'ACME', 1)).issue).toMatchObject({ title: 'mine2', description: 'd', priority: 'low', dueDate: null });
		await expect(updateIssue(as(guest), 'ACME', 2, { title: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
		await expect(updateIssue(as(guest2), 'ACME', 1, { title: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('値が変わっていない項目は権限チェックしない（フォームが全項目を送るため）', async () => {
		await createIssue(as(member), 'ACME', { title: 'theirs', assigneeId: guest.id });
		await updateIssue(as(guest), 'ACME', 1, { title: 'theirs', status: 'in_progress', assigneeId: guest.id });
		expect((await getIssue(as(guest), 'ACME', 1)).issue.status).toBe('in_progress');
	});

	it('ゲストは自分が担当の課題だけステータスを変えられ、担当者は変えられない', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(guest), 'ACME', 1, { status: 'done' });
		await expect(updateIssue(as(guest), 'ACME', 2, { status: 'done' })).rejects.toMatchObject({ code: 'forbidden' });
		await expect(updateIssue(as(guest), 'ACME', 1, { assigneeId: '' })).rejects.toMatchObject({ code: 'forbidden' });
		await updateIssue(as(member), 'ACME', 2, { assigneeId: guest2.id });
		expect((await getIssue(as(member), 'ACME', 2)).issue.assigneeName).toBe('guest2');
	});

	it('ステータスを変えると移動先の列の末尾に入る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		await updateIssue(as(member), 'ACME', 2, { status: 'done' });
		await updateIssue(as(member), 'ACME', 1, { status: 'done' });
		expect((await listBoard(as(member), 'ACME')).done.map((i) => i.number)).toEqual([2, 1]);
	});

	it('カンバン移動: 前後の課題の間に入る', async () => {
		for (const t of ['A', 'B', 'C']) await createIssue(as(member), 'ACME', { title: t });
		const ids = (await listBoard(as(member), 'ACME')).todo.map((i) => i.id);
		// C を A と B の間へ
		await moveIssue(as(member), 'ACME', { issueId: ids[2], status: 'todo', beforeId: ids[0], afterId: ids[1] });
		expect((await listBoard(as(member), 'ACME')).todo.map((i) => i.title)).toEqual(['A', 'C', 'B']);
		// B を in_review の空の列へ
		await moveIssue(as(member), 'ACME', { issueId: ids[1], status: 'in_review', beforeId: '', afterId: '' });
		const board = await listBoard(as(member), 'ACME');
		expect(board.in_review.map((i) => i.title)).toEqual(['B']);
		expect(board.todo.map((i) => i.title)).toEqual(['A', 'C']);
	});

	it('カンバン移動: 隣接 ID が別の列のもの（古い画面）なら validation', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		const [a, b] = (await listBoard(as(member), 'ACME')).todo;
		await updateIssue(as(member), 'ACME', b.number, { status: 'done' });
		await expect(
			moveIssue(as(member), 'ACME', { issueId: a.id, status: 'todo', beforeId: b.id, afterId: '' })
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('カンバン移動: ゲストは担当外の課題を動かせない', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const [a] = (await listBoard(as(member), 'ACME')).todo;
		await expect(
			moveIssue(as(guest), 'ACME', { issueId: a.id, status: 'done', beforeId: '', afterId: '' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('一覧の絞り込み', async () => {
		await createIssue(as(member), 'ACME', { title: 'A', assigneeId: guest.id, priority: 'high' });
		await createIssue(as(member), 'ACME', { title: 'B' });
		expect((await listIssues(as(member), 'ACME')).map((i) => i.number)).toEqual([2, 1]);
		expect((await listIssues(as(member), 'ACME', { assigneeId: 'none' })).map((i) => i.number)).toEqual([2]);
		expect((await listIssues(as(member), 'ACME', { assigneeId: guest.id })).map((i) => i.number)).toEqual([1]);
		expect((await listIssues(as(member), 'ACME', { priority: 'high' })).map((i) => i.number)).toEqual([1]);
		expect(await listIssues(as(member), 'ACME', { status: 'done' })).toHaveLength(0);
	});

	it('削除はメンバー以上。ゲストは不可', async () => {
		await createIssue(as(guest), 'ACME', { title: 'A' });
		await expect(deleteIssue(as(guest), 'ACME', 1)).rejects.toMatchObject({ code: 'forbidden' });
		await deleteIssue(as(member), 'ACME', 1);
		await expect(getIssue(as(member), 'ACME', 1)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('別プロジェクトの課題は番号を推測しても見えない', async () => {
		await seedProject(db, { key: 'OTHER' });
		await createIssue(as(admin), 'OTHER', { title: 'secret' });
		await expect(getIssue(as(guest), 'OTHER', 1)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('アーカイブ済みプロジェクトには起票できない', async () => {
		await seedProject(db, { key: 'OLD', members: [member], archived: true });
		await expect(createIssue(as(member), 'OLD', { title: 'A' })).rejects.toMatchObject({ code: 'conflict' });
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/issues.test.ts`
Expected: FAIL

- [ ] **Step 2: issues.ts を実装する**

`apps/web/src/lib/server/services/issues.ts`:
```ts
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/labels';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { issue, project, user } from '../db/schema';
import { AppError } from '../errors';
import { emptyToNull, parse } from '../validation';
import { assertAssignable, assertWritable, requireProject, type ProjectRow } from './projects';

const STALE = '並び順が古くなっています。画面を再読み込みしてください';

const TitleSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'タイトルを入力してください'),
	v.maxLength(200, 'タイトルは200文字以内で入力してください')
);
const DescriptionSchema = v.pipe(v.string(), v.maxLength(50_000, '説明は50,000文字以内で入力してください'));
const DateOrEmpty = v.union(
	[v.literal(''), v.pipe(v.string(), v.isoDate())],
	'日付の形式が正しくありません'
);

export interface IssueFilters {
	status?: Status;
	assigneeId?: string;
	priority?: Priority;
}

const assignee = alias(user, 'assignee');
const reporter = alias(user, 'reporter');

const listColumns = {
	id: issue.id,
	number: issue.number,
	title: issue.title,
	status: issue.status,
	priority: issue.priority,
	dueDate: issue.dueDate,
	position: issue.position,
	assigneeId: issue.assigneeId,
	assigneeName: assignee.name,
	reporterId: issue.reporterId,
	updatedAt: issue.updatedAt
};

export type IssueListItem = Awaited<ReturnType<typeof selectIssues>>[number];

function selectIssues(db: DB, where: SQL | undefined, order: SQL[]) {
	return db
		.select(listColumns)
		.from(issue)
		.leftJoin(assignee, eq(issue.assigneeId, assignee.id))
		.where(where)
		.orderBy(...order);
}

export async function listIssues(ctx: AppContext, key: string, filters: IssueFilters = {}) {
	const p = await requireProject(ctx, key);
	const conds: SQL[] = [eq(issue.projectId, p.id)];
	if (filters.status) conds.push(eq(issue.status, filters.status));
	if (filters.priority) conds.push(eq(issue.priority, filters.priority));
	if (filters.assigneeId === 'none') conds.push(isNull(issue.assigneeId));
	else if (filters.assigneeId) conds.push(eq(issue.assigneeId, filters.assigneeId));
	return selectIssues(ctx.db, and(...conds), [desc(issue.number)]);
}

export async function listBoard(ctx: AppContext, key: string): Promise<Record<Status, IssueListItem[]>> {
	const p = await requireProject(ctx, key);
	const rows = await selectIssues(ctx.db, eq(issue.projectId, p.id), [asc(issue.position), asc(issue.number)]);
	const board = Object.fromEntries(STATUSES.map((s) => [s, [] as IssueListItem[]])) as Record<Status, IssueListItem[]>;
	for (const r of rows) board[r.status].push(r);
	return board;
}

export async function getIssue(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	const [row] = await ctx.db
		.select({ issue, assigneeName: assignee.name, reporterName: reporter.name })
		.from(issue)
		.leftJoin(assignee, eq(issue.assigneeId, assignee.id))
		.innerJoin(reporter, eq(issue.reporterId, reporter.id))
		.where(and(eq(issue.projectId, p.id), eq(issue.number, number)));
	if (!row) throw new AppError('not_found', '課題が見つかりません');
	return {
		project: p as ProjectRow,
		issue: { ...row.issue, assigneeName: row.assigneeName, reporterName: row.reporterName }
	};
}

async function nextPosition(db: DB, projectId: string, status: Status): Promise<string> {
	const [row] = await db
		.select({ max: sql<string | null>`max(${issue.position})` })
		.from(issue)
		.where(and(eq(issue.projectId, projectId), eq(issue.status, status)));
	return generateKeyBetween(row?.max ?? null, null);
}

const CreateInput = v.object({
	title: TitleSchema,
	description: v.optional(DescriptionSchema, ''),
	priority: v.optional(v.picklist(PRIORITIES), 'none'),
	dueDate: v.optional(DateOrEmpty),
	assigneeId: v.optional(v.string())
});

export async function createIssue(ctx: AppContext, key: string, input: unknown): Promise<{ number: number }> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	authorize(ctx.actor, 'issue:create');
	const data = parse(CreateInput, input);
	const assigneeId = emptyToNull(data.assigneeId) ?? null;
	if (assigneeId) {
		authorize(ctx.actor, 'issue:assign');
		await assertAssignable(ctx.db, p.id, assigneeId);
	}
	const id = uuidv7();
	const position = await nextPosition(ctx.db, p.id, 'todo');
	await ctx.db.batch([
		ctx.db
			.update(project)
			.set({ nextIssueNumber: sql`${project.nextIssueNumber} + 1` })
			.where(eq(project.id, p.id)),
		ctx.db.insert(issue).values({
			id,
			projectId: p.id,
			number: sql`(select ${project.nextIssueNumber} - 1 from ${project} where ${project.id} = ${p.id})`,
			title: data.title,
			description: data.description,
			priority: data.priority,
			dueDate: emptyToNull(data.dueDate) ?? null,
			assigneeId,
			reporterId: ctx.actor.id,
			position
		})
	]);
	const [row] = await ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id));
	return { number: row.number };
}

const UpdateInput = v.object({
	title: v.optional(TitleSchema),
	description: v.optional(DescriptionSchema),
	priority: v.optional(v.picklist(PRIORITIES)),
	dueDate: v.optional(DateOrEmpty),
	status: v.optional(v.picklist(STATUSES)),
	assigneeId: v.optional(v.string())
});

/** 未送信（undefined）の項目は変更しない。値が変わった項目だけ権限を確認する。 */
export async function updateIssue(ctx: AppContext, key: string, number: number, input: unknown): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	const data = parse(UpdateInput, input);
	const res = { reporterId: cur.reporterId, assigneeId: cur.assigneeId };
	const patch: Partial<typeof issue.$inferInsert> = {};

	const dueDate = emptyToNull(data.dueDate);
	if (data.title !== undefined && data.title !== cur.title) patch.title = data.title;
	if (data.description !== undefined && data.description !== cur.description) patch.description = data.description;
	if (data.priority !== undefined && data.priority !== cur.priority) patch.priority = data.priority;
	if (dueDate !== undefined && dueDate !== cur.dueDate) patch.dueDate = dueDate;
	if (Object.keys(patch).length > 0) authorize(ctx.actor, 'issue:edit', res);

	if (data.status !== undefined && data.status !== cur.status) {
		authorize(ctx.actor, 'issue:changeStatus', res);
		patch.status = data.status;
		patch.position = await nextPosition(ctx.db, p.id, data.status);
	}

	const assigneeId = emptyToNull(data.assigneeId);
	if (assigneeId !== undefined && assigneeId !== cur.assigneeId) {
		authorize(ctx.actor, 'issue:assign', res);
		if (assigneeId) await assertAssignable(ctx.db, p.id, assigneeId);
		patch.assigneeId = assigneeId;
	}

	if (Object.keys(patch).length === 0) return;
	await ctx.db.update(issue).set(patch).where(eq(issue.id, cur.id));
}

const MoveInput = v.object({
	issueId: v.string(),
	status: v.picklist(STATUSES),
	beforeId: v.optional(v.string()),
	afterId: v.optional(v.string())
});

/** beforeId = 移動後に直前に来る課題、afterId = 直後に来る課題（同じ列のもの）。 */
export async function moveIssue(ctx: AppContext, key: string, input: unknown): Promise<void> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(MoveInput, input);
	const [cur] = await ctx.db
		.select()
		.from(issue)
		.where(and(eq(issue.id, data.issueId), eq(issue.projectId, p.id)));
	if (!cur) throw new AppError('not_found', '課題が見つかりません');
	authorize(ctx.actor, 'issue:changeStatus', { reporterId: cur.reporterId, assigneeId: cur.assigneeId });

	const neighbor = async (id: string | null | undefined): Promise<string | null> => {
		if (!id) return null;
		const [n] = await ctx.db
			.select({ position: issue.position, status: issue.status })
			.from(issue)
			.where(and(eq(issue.id, id), eq(issue.projectId, p.id)));
		if (!n || n.status !== data.status || id === cur.id) throw new AppError('validation', STALE);
		return n.position;
	};
	const lo = await neighbor(emptyToNull(data.beforeId));
	const hi = await neighbor(emptyToNull(data.afterId));

	let position: string;
	try {
		position = generateKeyBetween(lo, hi);
	} catch {
		throw new AppError('validation', STALE);
	}
	await ctx.db.update(issue).set({ status: data.status, position }).where(eq(issue.id, cur.id));
}

export async function deleteIssue(ctx: AppContext, key: string, number: number): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	authorize(ctx.actor, 'issue:delete');
	await ctx.db.delete(issue).where(eq(issue.id, cur.id));
}
```

`apps/web/src/lib/server/services/projects.ts` の `ProjectRow` の import がこのファイルで使われていることを確認する（`getIssue` の戻り値）。

Run: `pnpm test:unit --run src/lib/server/services/issues.test.ts`
Expected: PASS（13 tests）。同時起票テストが `SQLITE_BUSY` 等で落ちる場合は、`createIssue` の batch が 1 つの暗黙トランザクションで実行されているか（`db.batch` を使っているか）を確認する。

- [ ] **Step 3: 失敗するテストを書く（comments）**

`apps/web/src/lib/server/services/comments.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, deleteComment, editComment, listComments } from './comments';
import { createIssue } from './issues';

describe('comments', () => {
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
		await createIssue(as(member), 'ACME', { title: 'A' });
	});

	it('参加者は投稿でき、古い順に並ぶ', async () => {
		await addComment(as(guest), 'ACME', 1, { body: 'first' });
		await addComment(as(member), 'ACME', 1, { body: 'second' });
		const list = await listComments(as(member), 'ACME', 1);
		expect(list.map((c) => [c.body, c.authorName])).toEqual([['first', 'guest'], ['second', 'member']]);
	});

	it('空のコメントは validation', async () => {
		await expect(addComment(as(guest), 'ACME', 1, { body: '   ' })).rejects.toMatchObject({ code: 'validation' });
	});

	it('自分のコメントだけ編集・削除できる。admin は全部できる', async () => {
		await addComment(as(guest), 'ACME', 1, { body: 'g' });
		const [c] = await listComments(as(guest), 'ACME', 1);
		await expect(editComment(as(member), 'ACME', 1, c.id, { body: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
		await editComment(as(guest), 'ACME', 1, c.id, { body: 'g2' });
		expect((await listComments(as(guest), 'ACME', 1))[0].body).toBe('g2');
		await deleteComment(as(admin), 'ACME', 1, c.id);
		expect(await listComments(as(guest), 'ACME', 1)).toHaveLength(0);
	});

	it('別の課題の ID を指定しても操作できない', async () => {
		await createIssue(as(member), 'ACME', { title: 'B' });
		await addComment(as(guest), 'ACME', 1, { body: 'g' });
		const [c] = await listComments(as(guest), 'ACME', 1);
		await expect(deleteComment(as(guest), 'ACME', 2, c.id)).rejects.toMatchObject({ code: 'not_found' });
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/comments.test.ts`
Expected: FAIL

- [ ] **Step 4: comments.ts を実装する**

`apps/web/src/lib/server/services/comments.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { comment, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';
import { getIssue } from './issues';
import { assertWritable } from './projects';

const BodyInput = v.object({
	body: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, 'コメントを入力してください'),
		v.maxLength(20_000, 'コメントは20,000文字以内で入力してください')
	)
});

export async function listComments(ctx: AppContext, key: string, number: number) {
	const { issue } = await getIssue(ctx, key, number);
	return ctx.db
		.select({
			id: comment.id,
			body: comment.body,
			authorId: comment.authorId,
			authorName: user.name,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt
		})
		.from(comment)
		.innerJoin(user, eq(user.id, comment.authorId))
		.where(eq(comment.issueId, issue.id))
		.orderBy(asc(comment.createdAt), asc(comment.id));
}

export async function addComment(ctx: AppContext, key: string, number: number, input: unknown): Promise<void> {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	authorize(ctx.actor, 'comment:create');
	const { body } = parse(BodyInput, input);
	await ctx.db.insert(comment).values({ id: uuidv7(), issueId: issue.id, authorId: ctx.actor.id, body });
}

async function findOwnedComment(ctx: AppContext, key: string, number: number, commentId: string) {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	const [c] = await ctx.db
		.select()
		.from(comment)
		.where(and(eq(comment.id, commentId), eq(comment.issueId, issue.id)));
	if (!c) throw new AppError('not_found', 'コメントが見つかりません');
	authorize(ctx.actor, 'comment:modify', { authorId: c.authorId });
	return c;
}

export async function editComment(
	ctx: AppContext,
	key: string,
	number: number,
	commentId: string,
	input: unknown
): Promise<void> {
	const c = await findOwnedComment(ctx, key, number, commentId);
	const { body } = parse(BodyInput, input);
	await ctx.db.update(comment).set({ body }).where(eq(comment.id, c.id));
}

export async function deleteComment(ctx: AppContext, key: string, number: number, commentId: string): Promise<void> {
	const c = await findOwnedComment(ctx, key, number, commentId);
	await ctx.db.delete(comment).where(eq(comment.id, c.id));
}
```

Run: `pnpm test:unit --run && pnpm check`
Expected: 全テスト PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(services): add issues with numbering, kanban ordering and comments"
```

---

### Task 8: better-auth の設定と互換性テスト

**Files:**
- Create: `apps/web/src/lib/server/env.ts`, `apps/web/src/lib/server/auth.ts`
- Test: `apps/web/src/lib/server/auth.test.ts`, `apps/web/src/lib/server/env.test.ts`

**Interfaces:**
- Consumes: `DB`, `Mailer`, `resetPasswordMail`, `createFirstAdmin`, `disableUser`
- Produces:
  - `readEnv(raw: unknown): AppEnv`（`AppEnv = { TURSO_DATABASE_URL; TURSO_AUTH_TOKEN?; BETTER_AUTH_SECRET; BETTER_AUTH_URL; MAIL_PROVIDER; MAIL_API_KEY?; MAIL_FROM? }`）
  - `createAuth(env: Pick<AppEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>, db: DB, opts: { mailer: Mailer; waitUntil: (p: Promise<unknown>) => void; plugins?: ReturnType<typeof sveltekitCookies>[] })`、`type Auth = ReturnType<typeof createAuth>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/server/env.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readEnv } from './env';

const ok = {
	TURSO_DATABASE_URL: 'http://127.0.0.1:8080',
	BETTER_AUTH_SECRET: 'x'.repeat(32),
	BETTER_AUTH_URL: 'http://localhost:5173'
};

describe('readEnv', () => {
	it('MAIL_PROVIDER の既定値は console', () => {
		expect(readEnv(ok).MAIL_PROVIDER).toBe('console');
	});
	it('必須値が無いと、名前が分かるエラーを投げる', () => {
		expect(() => readEnv({ ...ok, BETTER_AUTH_SECRET: undefined })).toThrow('BETTER_AUTH_SECRET');
	});
});
```

`apps/web/src/lib/server/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import { createTestBase, createTestDb, seedUser } from './test-utils';
import { createFirstAdmin } from './services/setup';

const env = { BETTER_AUTH_SECRET: 'test-secret-'.repeat(4), BETTER_AUTH_URL: 'http://localhost:5173' };

describe('createAuth', () => {
	it('自前で作った credential ユーザーで better-auth のログインができる', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		const authCtx = await auth.$context;
		base.hashPassword = (pw) => authCtx.password.hash(pw);

		await createFirstAdmin(base, { name: '管理者', email: 'admin@example.com', password: 'password-1234' });

		const res = await auth.api.signInEmail({ body: { email: 'admin@example.com', password: 'password-1234' } });
		expect(res.user.email).toBe('admin@example.com');
		expect(res.token).toBeTruthy();
	});

	it('間違ったパスワードは拒否される', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		base.hashPassword = async (pw) => (await auth.$context).password.hash(pw);
		await createFirstAdmin(base, { name: 'A', email: 'a@example.com', password: 'password-1234' });
		await expect(
			auth.api.signInEmail({ body: { email: 'a@example.com', password: 'wrong-password' } })
		).rejects.toThrow();
	});

	it('公開サインアップは無効', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		await expect(
			auth.api.signUpEmail({ body: { name: 'x', email: 'x@example.com', password: 'password-1234' } })
		).rejects.toThrow();
	});

	it('パスワードリセットを要求するとメールを送る', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const auth = createAuth(env, db, { mailer: base.mailer, waitUntil: base.waitUntil });
		const member = await seedUser(db, 'member');
		await auth.api.requestPasswordReset({
			body: { email: member.email, redirectTo: 'http://localhost:5173/reset-password' }
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(base.sent).toHaveLength(1);
		expect(base.sent[0].to).toBe(member.email);
		expect(base.sent[0].text).toContain('/api/auth/reset-password/');
	});
});
```

Run: `pnpm test:unit --run src/lib/server/auth.test.ts src/lib/server/env.test.ts`
Expected: FAIL

- [ ] **Step 2: env.ts と auth.ts を実装する**

`apps/web/src/lib/server/env.ts`:
```ts
import * as v from 'valibot';

const EnvSchema = v.object({
	TURSO_DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
	TURSO_AUTH_TOKEN: v.optional(v.string()),
	BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(32)),
	BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
	MAIL_PROVIDER: v.optional(v.picklist(['smtp2go', 'resend', 'console']), 'console'),
	MAIL_API_KEY: v.optional(v.string()),
	MAIL_FROM: v.optional(v.string())
});

export type AppEnv = v.InferOutput<typeof EnvSchema>;

export function readEnv(raw: unknown): AppEnv {
	const r = v.safeParse(EnvSchema, raw);
	if (r.success) return r.output;
	const names = r.issues.map((i) => v.getDotPath(i)).join(', ');
	throw new Error(`Invalid environment variables: ${names}. See .dev.vars.example / docs.`);
}
```

`apps/web/src/lib/server/auth.ts`:
```ts
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { betterAuth } from 'better-auth';
import type { sveltekitCookies } from 'better-auth/svelte-kit';
import type { DB } from './db';
import { account, rateLimit, session, user, verification } from './db/schema';
import type { AppEnv } from './env';
import type { Mailer } from './mailer';
import { resetPasswordMail } from './mailer/templates';

export function createAuth(
	env: Pick<AppEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>,
	db: DB,
	opts: {
		mailer: Mailer;
		waitUntil: (p: Promise<unknown>) => void;
		plugins?: ReturnType<typeof sveltekitCookies>[];
	}
) {
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema: { user, session, account, verification, rateLimit }
		}),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			minPasswordLength: 10,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: 3600,
			sendResetPassword: async ({ user: u, url }) => {
				opts.waitUntil(
					opts.mailer
						.send({ to: u.email, ...resetPasswordMail({ url }) })
						.catch((e) => console.error('reset password mail failed', e))
				);
			}
		},
		user: {
			additionalFields: {
				role: { type: ['admin', 'member', 'guest'], required: true, input: false, defaultValue: 'member' },
				disabledAt: { type: 'date', required: false, input: false }
			}
		},
		rateLimit: {
			enabled: true,
			storage: 'database',
			window: 60,
			max: 100,
			customRules: {
				'/sign-in/email': { window: 60, max: 5 },
				'/request-password-reset': { window: 300, max: 3 }
			}
		},
		advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
		plugins: opts.plugins ?? []
	});
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 3: テスト実行**

Run: `pnpm test:unit --run src/lib/server/auth.test.ts src/lib/server/env.test.ts`
Expected: PASS

うまくいかない場合の確認ポイント（推測で直さず、エラーメッセージを読んで原因を特定すること）:
- `signInEmail` が "invalid email or password" → `account` 行の `providerId` が `'credential'`、`accountId` が `userId` と同じか。ハッシュが `authCtx.password.hash` で作られているか。
- アダプタが「model not found」系 → `schema` に渡したキー名（`rateLimit` など）と better-auth のモデル名が一致しているか。
- `role` が無い → `additionalFields` の設定。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(auth): configure better-auth with drizzle v1 and verify credential compatibility"
```

---

### Task 9: hooks・レイアウト・認証画面

**Files:**
- Modify: `apps/web/src/app.d.ts`, `apps/web/src/routes/+layout.svelte`, `apps/web/src/routes/layout.css`
- Create: `apps/web/src/hooks.server.ts`, `apps/web/src/routes/+layout.server.ts`
- Create: `apps/web/src/routes/login/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/setup/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/forgot-password/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/reset-password/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/invite/[token]/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/logout/+server.ts`
- Create: `apps/web/src/routes/account/+page.server.ts`, `+page.svelte`

**Interfaces:**
- Consumes: Task 3〜8 の全て
- Produces: `App.Locals = { auth: Auth; base: BaseContext; user: Actor | null }`、CSS クラス `.input` `.btn` `.btn-primary` `.card` `.markdown`

- [ ] **Step 1: 型と hooks**

`apps/web/src/app.d.ts`:
```ts
import type { Auth } from '$lib/server/auth';
import type { Actor } from '$lib/server/authz';
import type { BaseContext } from '$lib/server/context';

declare global {
	namespace App {
		interface Locals {
			auth: Auth;
			base: BaseContext;
			user: Actor | null;
		}
	}
}

export {};
```

`apps/web/src/hooks.server.ts`:
```ts
import { building } from '$app/env';
import { getRequestEvent } from '$app/server';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { svelteKitHandler, sveltekitCookies } from 'better-auth/svelte-kit';
import { env, waitUntil } from 'cloudflare:workers';
import { createAuth } from '$lib/server/auth';
import type { Role } from '$lib/server/authz';
import { createDb } from '$lib/server/db';
import { readEnv } from '$lib/server/env';
import { createMailer } from '$lib/server/mailer';

const PUBLIC_PATHS = [
	/^\/login$/,
	/^\/setup$/,
	/^\/forgot-password$/,
	/^\/reset-password$/,
	/^\/invite\/[^/]+$/,
	/^\/api\/auth\//
];

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	const appEnv = readEnv(env);
	const db = createDb(appEnv);
	const mailer = createMailer(appEnv);
	const auth = createAuth(appEnv, db, {
		mailer,
		waitUntil,
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	const authCtx = await auth.$context;

	event.locals.auth = auth;
	event.locals.base = {
		db,
		mailer,
		waitUntil,
		baseUrl: appEnv.BETTER_AUTH_URL,
		hashPassword: (pw) => authCtx.password.hash(pw)
	};

	const s = await auth.api.getSession({ headers: event.request.headers });
	if (s?.user.disabledAt) {
		await authCtx.internalAdapter.deleteUserSessions(s.user.id);
	}
	event.locals.user =
		s && !s.user.disabledAt
			? { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role as Role }
			: null;

	const path = event.url.pathname;
	if (!event.locals.user && !PUBLIC_PATHS.some((r) => r.test(path))) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
	}

	return svelteKitHandler({ auth, event, resolve, building });
};

export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[${event.request.method} ${event.url.pathname}]`, error);
	return { message: 'エラーが発生しました。時間をおいて再度お試しください' };
};
```

`svelte-check` で `cloudflare:workers` の型が見つからない場合は、`pnpm gen`（`wrangler types`）を実行してから再チェックする。

- [ ] **Step 2: スタイルとレイアウト**

`apps/web/src/routes/layout.css`（scaffold の `@import 'tailwindcss';` の下に追加）:
```css
@layer components {
	.input {
		@apply mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500;
	}
	.btn {
		@apply inline-flex items-center justify-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50;
	}
	.btn-primary {
		@apply inline-flex items-center justify-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50;
	}
	.card {
		@apply rounded border border-gray-200 bg-white p-4;
	}
	.markdown a {
		@apply text-blue-600 underline;
	}
	.markdown p,
	.markdown ul,
	.markdown ol,
	.markdown pre {
		@apply my-2;
	}
	.markdown ul {
		@apply list-disc pl-6;
	}
	.markdown ol {
		@apply list-decimal pl-6;
	}
	.markdown code {
		@apply rounded bg-gray-100 px-1 text-sm;
	}
	.markdown pre {
		@apply overflow-x-auto rounded bg-gray-100 p-3;
	}
}

body {
	@apply bg-gray-50 text-gray-900;
}
```

`apps/web/src/routes/+layout.server.ts`:
```ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({ user: locals.user });
```

`apps/web/src/routes/+layout.svelte`（favicon の import 行は scaffold のものを残す）:
```svelte
<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { FolderKanban, LogOut, UserRound, Users } from '@lucide/svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Project Manager</title>
</svelte:head>

{#if data.user}
	<header class="border-b border-gray-200 bg-white">
		<nav class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
			<a href="/" class="flex items-center gap-2 font-semibold">
				<FolderKanban size={18} />Project Manager
			</a>
			<div class="ml-auto flex items-center gap-4">
				{#if data.user.role === 'admin'}
					<a href="/admin/users" class="flex items-center gap-1"><Users size={16} />ユーザー</a>
				{/if}
				<a href="/account" class="flex items-center gap-1"><UserRound size={16} />{data.user.name}</a>
				<form method="POST" action="/logout">
					<button class="flex items-center gap-1"><LogOut size={16} />ログアウト</button>
				</form>
			</div>
		</nav>
	</header>
{/if}

<main class="mx-auto max-w-6xl px-4 py-6">
	{@render children()}
</main>
```

- [ ] **Step 3: ログイン・ログアウト**

`apps/web/src/routes/login/+page.server.ts`:
```ts
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { consumeRateLimit, LOGIN_LIMIT } from '$lib/server/ratelimit';
import { safeRedirect } from '$lib/server/redirect';
import { needsSetup } from '$lib/server/services/setup';
import { isDisabledEmail } from '$lib/server/services/users';
import type { Actions, PageServerLoad } from './$types';

const INVALID = 'メールアドレスまたはパスワードが違います';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	if (await needsSetup(locals.base.db)) redirect(303, '/setup');
};

export const actions: Actions = {
	default: async ({ request, locals, url, getClientAddress }) => {
		const fd = await request.formData();
		const email = String(fd.get('email') ?? '').trim().toLowerCase();
		const password = String(fd.get('password') ?? '');

		if (!(await consumeRateLimit(locals.base.db, `app:login:${getClientAddress()}`, LOGIN_LIMIT))) {
			return fail(429, { message: '試行回数が多すぎます。しばらくしてから再度お試しください', email });
		}
		if (await isDisabledEmail(locals.base.db, email)) return fail(400, { message: INVALID, email });

		try {
			await locals.auth.api.signInEmail({ body: { email, password }, headers: request.headers });
		} catch (e) {
			if (e instanceof APIError) return fail(400, { message: INVALID, email });
			throw e;
		}
		redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
```

`apps/web/src/routes/login/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">ログイン</h1>
	<form method="POST" use:enhance class="card space-y-4">
		{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
		<label class="block">
			<span class="text-sm">メールアドレス</span>
			<input class="input" name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
		</label>
		<label class="block">
			<span class="text-sm">パスワード</span>
			<input class="input" name="password" type="password" autocomplete="current-password" required />
		</label>
		<button class="btn-primary w-full">ログイン</button>
	</form>
	<p class="mt-4 text-center text-sm">
		<a href="/forgot-password" class="text-blue-600 underline">パスワードを忘れた場合</a>
	</p>
</div>
```

`apps/web/src/routes/logout/+server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	await locals.auth.api.signOut({ headers: request.headers });
	redirect(303, '/login');
};
```

- [ ] **Step 4: 初期セットアップ**

`apps/web/src/routes/setup/+page.server.ts`:
```ts
import { fail, redirect } from '@sveltejs/kit';
import { handleAction } from '$lib/server/errors';
import { consumeRateLimit, SIGNUP_LIMIT } from '$lib/server/ratelimit';
import { createFirstAdmin, needsSetup } from '$lib/server/services/setup';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!(await needsSetup(locals.base.db))) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!(await consumeRateLimit(locals.base.db, `app:signup:${getClientAddress()}`, SIGNUP_LIMIT))) {
			return fail(429, { message: '試行回数が多すぎます', fields: {} });
		}
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { email } = await createFirstAdmin(locals.base, input);
			await locals.auth.api.signInEmail({ body: { email, password: input.password }, headers: request.headers });
			redirect(303, '/');
		});
	}
};
```

`apps/web/src/routes/setup/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-2 text-2xl font-bold">初期セットアップ</h1>
	<p class="mb-6 text-sm text-gray-600">最初の管理者アカウントを作成します。</p>
	<form method="POST" use:enhance class="card space-y-4">
		{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
		<label class="block">
			<span class="text-sm">名前</span>
			<input class="input" name="name" required maxlength="50" />
		</label>
		<label class="block">
			<span class="text-sm">メールアドレス</span>
			<input class="input" name="email" type="email" autocomplete="email" required />
		</label>
		<label class="block">
			<span class="text-sm">パスワード（10文字以上）</span>
			<input class="input" name="password" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		<button class="btn-primary w-full">セットアップを完了</button>
	</form>
</div>
```

- [ ] **Step 5: 招待の受諾**

`apps/web/src/routes/invite/[token]/+page.server.ts`:
```ts
import { fail, redirect } from '@sveltejs/kit';
import { ROLE_LABEL } from '$lib/labels';
import { handleAction } from '$lib/server/errors';
import { consumeRateLimit, SIGNUP_LIMIT } from '$lib/server/ratelimit';
import { acceptInvitation, getInvitationByToken } from '$lib/server/services/invitations';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const inv = await getInvitationByToken(locals.base.db, params.token);
	return { invitation: inv && { ...inv, roleLabel: ROLE_LABEL[inv.role] } };
};

export const actions: Actions = {
	default: async ({ request, locals, params, getClientAddress }) => {
		if (!(await consumeRateLimit(locals.base.db, `app:signup:${getClientAddress()}`, SIGNUP_LIMIT))) {
			return fail(429, { message: '試行回数が多すぎます', fields: {} });
		}
		const input = { ...formObject(await request.formData()), token: params.token };
		return handleAction(async () => {
			const { email } = await acceptInvitation(locals.base, input);
			await locals.auth.api.signInEmail({ body: { email, password: input.password }, headers: request.headers });
			redirect(303, '/');
		});
	}
};
```

招待が無効（`not_found`）の場合 `handleAction` は 404 を投げるが、ここでは「無効」メッセージを表示したいので、load 側で `invitation: null` を返す画面を用意している。受諾時に別タブで先に使われたケースは 404 ページになるが、許容する。

`apps/web/src/routes/invite/[token]/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	{#if !data.invitation}
		<h1 class="mb-4 text-2xl font-bold">招待リンクが無効です</h1>
		<p class="text-sm text-gray-600">
			招待リンクが無効か、期限切れです。管理者に再発行を依頼してください。
		</p>
	{:else}
		<h1 class="mb-2 text-2xl font-bold">アカウント登録</h1>
		<p class="mb-6 text-sm text-gray-600">
			{data.invitation.email} を{data.invitation.roleLabel}として登録します{#if data.invitation.projectName}（プロジェクト: {data.invitation.projectName}）{/if}。
		</p>
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<label class="block">
				<span class="text-sm">名前</span>
				<input class="input" name="name" required maxlength="50" />
			</label>
			<label class="block">
				<span class="text-sm">パスワード（10文字以上）</span>
				<input class="input" name="password" type="password" autocomplete="new-password" required minlength="10" />
			</label>
			<button class="btn-primary w-full">登録する</button>
		</form>
	{/if}
</div>
```

- [ ] **Step 6: パスワードリセット**

`apps/web/src/routes/forgot-password/+page.server.ts`:
```ts
import { fail } from '@sveltejs/kit';
import { consumeRateLimit, RESET_LIMIT } from '$lib/server/ratelimit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!(await consumeRateLimit(locals.base.db, `app:reset:${getClientAddress()}`, RESET_LIMIT))) {
			return fail(429, { message: '試行回数が多すぎます。しばらくしてから再度お試しください' });
		}
		const email = String((await request.formData()).get('email') ?? '').trim().toLowerCase();
		try {
			await locals.auth.api.requestPasswordReset({
				body: { email, redirectTo: `${locals.base.baseUrl}/reset-password` }
			});
		} catch (e) {
			console.error('requestPasswordReset failed', e);
		}
		// アカウントの有無を漏らさないため、結果は常に同じ
		return { sent: true };
	}
};
```

`apps/web/src/routes/forgot-password/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">パスワードの再設定</h1>
	{#if form?.sent}
		<p class="card text-sm">
			登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールを確認してください。
		</p>
	{:else}
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<label class="block">
				<span class="text-sm">メールアドレス</span>
				<input class="input" name="email" type="email" autocomplete="email" required />
			</label>
			<button class="btn-primary w-full">再設定リンクを送る</button>
		</form>
	{/if}
	<p class="mt-4 text-center text-sm"><a href="/login" class="text-blue-600 underline">ログインに戻る</a></p>
</div>
```

`apps/web/src/routes/reset-password/+page.server.ts`:
```ts
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
	token: url.searchParams.get('token'),
	invalid: url.searchParams.get('error') === 'INVALID_TOKEN'
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const token = String(fd.get('token') ?? '');
		const newPassword = String(fd.get('password') ?? '');
		if (newPassword.length < 10) return fail(400, { message: 'パスワードは10文字以上にしてください' });
		try {
			await locals.auth.api.resetPassword({ body: { token, newPassword } });
		} catch (e) {
			if (e instanceof APIError) return fail(400, { message: 'リンクが無効か期限切れです。もう一度やり直してください' });
			throw e;
		}
		redirect(303, '/login');
	}
};
```

`apps/web/src/routes/reset-password/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">新しいパスワード</h1>
	{#if data.invalid || !data.token}
		<p class="card text-sm">
			リンクが無効か期限切れです。<a href="/forgot-password" class="text-blue-600 underline">もう一度やり直してください</a>。
		</p>
	{:else}
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<input type="hidden" name="token" value={data.token} />
			<label class="block">
				<span class="text-sm">新しいパスワード（10文字以上）</span>
				<input class="input" name="password" type="password" autocomplete="new-password" required minlength="10" />
			</label>
			<button class="btn-primary w-full">パスワードを変更</button>
		</form>
	{/if}
</div>
```

- [ ] **Step 7: アカウント設定**

`apps/web/src/routes/account/+page.server.ts`:
```ts
import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { handleAction } from '$lib/server/errors';
import { formObject, NameSchema, parse, PasswordSchema } from '$lib/server/validation';
import type { Actions } from './$types';

export const actions: Actions = {
	updateName: async ({ request, locals }) =>
		handleAction(async () => {
			const { name } = parse(v.object({ name: NameSchema }), formObject(await request.formData()));
			await locals.auth.api.updateUser({ body: { name }, headers: request.headers });
			return { nameSaved: true };
		}),
	changePassword: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const data = parse(v.object({ currentPassword: v.string(), newPassword: PasswordSchema }), input);
			try {
				await locals.auth.api.changePassword({
					body: { ...data, revokeOtherSessions: true },
					headers: request.headers
				});
			} catch (e) {
				if (e instanceof APIError) return fail(400, { message: '現在のパスワードが違います', fields: {} });
				throw e;
			}
			return { passwordSaved: true };
		});
	}
};
```

`apps/web/src/routes/account/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">アカウント</h1>
{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<div class="grid gap-6 md:grid-cols-2">
	<form method="POST" action="?/updateName" use:enhance class="card space-y-4">
		<h2 class="font-semibold">表示名</h2>
		<label class="block">
			<span class="text-sm">名前</span>
			<input class="input" name="name" required maxlength="50" value={data.user?.name} />
		</label>
		<button class="btn-primary">保存</button>
		{#if form?.nameSaved}<p class="text-sm text-green-700">保存しました</p>{/if}
	</form>

	<form method="POST" action="?/changePassword" use:enhance class="card space-y-4">
		<h2 class="font-semibold">パスワード変更</h2>
		<label class="block">
			<span class="text-sm">現在のパスワード</span>
			<input class="input" name="currentPassword" type="password" autocomplete="current-password" required />
		</label>
		<label class="block">
			<span class="text-sm">新しいパスワード（10文字以上）</span>
			<input class="input" name="newPassword" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		<button class="btn-primary">変更</button>
		{#if form?.passwordSaved}<p class="text-sm text-green-700">変更しました。他の端末はログアウトされます</p>{/if}
	</form>
</div>
```

- [ ] **Step 8: 手動で動作確認**

```bash
cd apps/web
cp .dev.vars.example .dev.vars
# .dev.vars の BETTER_AUTH_SECRET を `openssl rand -base64 32` の出力に置き換える
pnpm db:local          # 別ターミナルで起動したままにする
pnpm db:migrate        # 既定で http://127.0.0.1:8080 に適用
pnpm dev
```
ブラウザで `http://localhost:5173` を開き、次を確認する:
1. `/login` に飛ばされ、さらに `/setup` にリダイレクトされる
2. セットアップ → トップページ（まだ 404 か空でよい）に遷移し、ヘッダーに名前が出る
3. ログアウト → `/login`。間違ったパスワードでエラー表示、正しいパスワードでログイン
4. `/forgot-password` で自分のメールを送信 → `pnpm dev` のターミナルに `[mail]` ログとリンクが出る → リンクを開いてパスワード変更 → 新しいパスワードでログインできる
5. `/account` で名前を変えるとヘッダーに反映される

Run: `pnpm lint && pnpm check && pnpm test:unit --run`
Expected: すべて成功

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): add auth hooks, layout and authentication pages"
```

---

### Task 10: 管理画面とプロジェクト画面（一覧・起票・詳細・設定）

**Files:**
- Create: `apps/web/src/lib/components/InviteLinkBox.svelte`
- Create: `apps/web/src/routes/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/admin/+layout.server.ts`
- Create: `apps/web/src/routes/admin/users/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/admin/projects/new/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/projects/[key]/+layout.server.ts`, `+layout.svelte`, `+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/projects/[key]/issues/new/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/projects/[key]/issues/[number]/+page.server.ts`, `+page.svelte`
- Create: `apps/web/src/routes/projects/[key]/settings/+page.server.ts`, `+page.svelte`

**Interfaces:**
- Consumes: Task 5〜7 の services、`appContext`, `handleAction`, `handleLoad`, `formObject`, `renderMarkdown`, `can`
- Produces: 画面の文言（E2E が依存する）— ボタン「新規プロジェクト」「作成」「招待する」「ゲストを招待」「新規課題」「起票する」「保存」「コメントする」、ラベル「キー」「プロジェクト名」「メールアドレス」「ロール」「参加プロジェクト」「ゲストのメールアドレス」「招待リンク」「タイトル」「担当者」「ステータス」「コメントを追加」、見出し「プロジェクト」

- [ ] **Step 1: 招待リンク表示コンポーネント**

`apps/web/src/lib/components/InviteLinkBox.svelte`:
```svelte
<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	let { url }: { url: string } = $props();
	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(url);
		copied = true;
	}
</script>

<div class="rounded border border-green-300 bg-green-50 p-3 text-sm">
	<label class="block">
		<span>招待リンク</span>
		<input class="input font-mono text-xs" readonly value={url} onfocus={(e) => e.currentTarget.select()} />
	</label>
	<button type="button" class="btn mt-2" onclick={copy}>
		{#if copied}<Check size={14} />コピーしました{:else}<Copy size={14} />コピー{/if}
	</button>
	<p class="mt-2 text-xs text-gray-600">このリンクは 7 日間有効です。メールが届かない場合は直接相手に渡してください。</p>
</div>
```

- [ ] **Step 2: トップ（プロジェクト一覧）**

`apps/web/src/routes/+page.server.ts`:
```ts
import { appContext } from '$lib/server/context';
import { listProjects } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const projects = await listProjects(appContext(locals));
	return {
		active: projects.filter((p) => !p.archivedAt),
		archived: projects.filter((p) => p.archivedAt)
	};
};
```

`apps/web/src/routes/+page.svelte`:
```svelte
<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-6 flex items-center">
	<h1 class="text-2xl font-bold">プロジェクト</h1>
	{#if data.user?.role === 'admin'}
		<a href="/admin/projects/new" class="btn-primary ml-auto"><Plus size={16} />新規プロジェクト</a>
	{/if}
</div>

{#if data.active.length === 0}
	<p class="text-sm text-gray-600">参加しているプロジェクトはありません。</p>
{/if}
<ul class="grid gap-4 md:grid-cols-3">
	{#each data.active as p (p.id)}
		<li>
			<a href={`/projects/${p.key}`} class="card block hover:border-blue-400">
				<p class="text-xs text-gray-500">{p.key}</p>
				<p class="font-semibold">{p.name}</p>
			</a>
		</li>
	{/each}
</ul>

{#if data.archived.length > 0}
	<details class="mt-8">
		<summary class="cursor-pointer text-sm text-gray-600">アーカイブ済み（{data.archived.length}）</summary>
		<ul class="mt-2 space-y-1 text-sm">
			{#each data.archived as p (p.id)}
				<li><a href={`/projects/${p.key}`} class="underline">{p.key} {p.name}</a></li>
			{/each}
		</ul>
	</details>
{/if}
```

- [ ] **Step 3: 管理画面**

`apps/web/src/routes/admin/+layout.server.ts`:
```ts
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (locals.user?.role !== 'admin') error(404, 'Not found');
};
```

`apps/web/src/routes/admin/projects/new/+page.server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import { appContext } from '$lib/server/context';
import { handleAction } from '$lib/server/errors';
import { createProject } from '$lib/server/services/projects';
import { formObject } from '$lib/server/validation';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { key } = await createProject(appContext(locals), input);
			redirect(303, `/projects/${key}`);
		});
	}
};
```

`apps/web/src/routes/admin/projects/new/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">新規プロジェクト</h1>
<form method="POST" use:enhance class="card max-w-lg space-y-4">
	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
	<label class="block">
		<span class="text-sm">キー（英字で始まる2〜10文字。課題番号の接頭辞になり、後から変更できません）</span>
		<input class="input uppercase" name="key" required pattern="[A-Za-z][A-Za-z0-9]{'{'}1,9{'}'}" />
		{#if form?.fields?.key}<span class="text-xs text-red-600">{form.fields.key[0]}</span>{/if}
	</label>
	<label class="block">
		<span class="text-sm">プロジェクト名</span>
		<input class="input" name="name" required maxlength="100" />
	</label>
	<label class="block">
		<span class="text-sm">説明（Markdown）</span>
		<textarea class="input" name="description" rows="4"></textarea>
	</label>
	<button class="btn-primary">作成</button>
</form>
```

`apps/web/src/routes/admin/users/+page.server.ts`:
```ts
import { appContext } from '$lib/server/context';
import { handleAction } from '$lib/server/errors';
import {
	createInvitation,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from '$lib/server/services/invitations';
import { listProjects } from '$lib/server/services/projects';
import { disableUser, listUsers } from '$lib/server/services/users';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	const [users, invitations, projects] = await Promise.all([
		listUsers(ctx),
		listPendingInvitations(ctx),
		listProjects(ctx)
	]);
	return { users, invitations, projects: projects.filter((p) => !p.archivedAt) };
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { url } = await createInvitation(appContext(locals), input);
			return { inviteUrl: url };
		});
	},
	reissue: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			const { url } = await reissueInvitation(appContext(locals), id);
			return { inviteUrl: url };
		});
	},
	revoke: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await revokeInvitation(appContext(locals), id);
		});
	},
	disable: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await disableUser(appContext(locals), id);
		});
	}
};
```

`apps/web/src/routes/admin/users/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">ユーザー</h1>
{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<section class="card mb-8 space-y-4">
	<h2 class="font-semibold">招待</h2>
	<form method="POST" action="?/invite" use:enhance class="grid gap-4 md:grid-cols-4 md:items-end">
		<label class="block md:col-span-2">
			<span class="text-sm">メールアドレス</span>
			<input class="input" name="email" type="email" required />
		</label>
		<label class="block">
			<span class="text-sm">ロール</span>
			<select class="input" name="role">
				<option value="member">メンバー</option>
				<option value="guest">ゲスト</option>
			</select>
		</label>
		<label class="block">
			<span class="text-sm">参加プロジェクト（ゲストは必須）</span>
			<select class="input" name="projectId">
				<option value="">なし</option>
				{#each data.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		</label>
		<button class="btn-primary md:col-span-4 md:justify-self-start">招待する</button>
	</form>
	{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
</section>

<section class="mb-8">
	<h2 class="mb-2 font-semibold">未使用の招待</h2>
	{#if data.invitations.length === 0}<p class="text-sm text-gray-600">ありません。</p>{/if}
	<ul class="space-y-2">
		{#each data.invitations as inv (inv.id)}
			<li class="card flex flex-wrap items-center gap-3 text-sm">
				<span>{inv.email}</span>
				<span class="text-gray-500">{ROLE_LABEL[inv.role]}{inv.projectName ? ` / ${inv.projectName}` : ''}</span>
				{#if inv.expired}<span class="text-red-600">期限切れ</span>{/if}
				<form method="POST" action="?/reissue" use:enhance class="ml-auto flex items-center gap-2">
					<input type="hidden" name="id" value={inv.id} />
					<span class="text-xs text-gray-600">コピーすると招待を再発行し、以前のリンクは無効になります</span>
					<button class="btn">リンクをコピー</button>
				</form>
				<form method="POST" action="?/revoke" use:enhance>
					<input type="hidden" name="id" value={inv.id} />
					<button class="btn">取り消し</button>
				</form>
			</li>
		{/each}
	</ul>
</section>

<section>
	<h2 class="mb-2 font-semibold">登録済みユーザー</h2>
	<table class="w-full bg-white text-sm">
		<thead class="text-left text-gray-500">
			<tr><th class="p-2">名前</th><th class="p-2">メール</th><th class="p-2">ロール</th><th class="p-2"></th></tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr class="border-t border-gray-200">
					<td class="p-2">{u.name}</td>
					<td class="p-2">{u.email}</td>
					<td class="p-2">{ROLE_LABEL[u.role]}</td>
					<td class="p-2 text-right">
						{#if u.disabledAt}
							<span class="text-gray-500">無効</span>
						{:else if u.id !== data.user?.id}
							<form
								method="POST"
								action="?/disable"
								use:enhance={({ cancel }) => {
									if (!confirm(`${u.name} を無効化しますか？ すぐにログアウトされます`)) cancel();
								}}
							>
								<input type="hidden" name="id" value={u.id} />
								<button class="btn">無効化</button>
							</form>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
```

「リンクをコピー」を押すと再発行 action が走り、結果の `InviteLinkBox`（招待フォームの下）にリンクが表示されるので、そこでコピーする。

- [ ] **Step 4: プロジェクトのレイアウトと課題一覧**

`apps/web/src/routes/projects/[key]/+layout.server.ts`:
```ts
import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { requireProject } from '$lib/server/services/projects';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	const project = await handleLoad(() => requireProject(ctx, params.key));
	return { project, isAdmin: ctx.actor.role === 'admin' };
};
```

`apps/web/src/routes/projects/[key]/+layout.svelte`:
```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { Kanban, List, Settings } from '@lucide/svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const tabs = $derived([
		{ href: base, label: '一覧', icon: List },
		{ href: `${base}/board`, label: 'ボード', icon: Kanban },
		...(data.isAdmin ? [{ href: `${base}/settings`, label: '設定', icon: Settings }] : [])
	]);
</script>

<div class="mb-6">
	<p class="text-xs text-gray-500">{data.project.key}</p>
	<h1 class="text-2xl font-bold">{data.project.name}</h1>
	{#if data.project.archivedAt}
		<p class="mt-1 text-sm text-amber-700">このプロジェクトはアーカイブ済みです（閲覧のみ）。</p>
	{/if}
	<nav class="mt-4 flex gap-4 border-b border-gray-200 text-sm">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class="flex items-center gap-1 border-b-2 px-1 pb-2 {page.url.pathname === t.href
					? 'border-blue-600 font-medium'
					: 'border-transparent text-gray-600'}"
			>
				<t.icon size={16} />{t.label}
			</a>
		{/each}
	</nav>
</div>

{@render children()}
```

`apps/web/src/routes/projects/[key]/+page.server.ts`:
```ts
import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/labels';
import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { listIssues } from '$lib/server/services/issues';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	const q = url.searchParams;
	const status = q.get('status');
	const priority = q.get('priority');
	const filters = {
		status: STATUSES.includes(status as Status) ? (status as Status) : undefined,
		priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
		assigneeId: q.get('assignee') || undefined
	};
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [issues, assignees] = await Promise.all([
			listIssues(ctx, params.key, filters),
			listAssignableUsers(ctx.db, p.id)
		]);
		return { issues, assignees, filters };
	});
};
```

`apps/web/src/routes/projects/[key]/+page.svelte`:
```svelte
<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-4 flex flex-wrap items-end gap-2">
	<form method="GET" class="flex flex-wrap items-end gap-2 text-sm">
		<label class="block">
			<span>ステータス</span>
			<select class="input" name="status">
				<option value="">すべて</option>
				{#each STATUSES as s (s)}<option value={s} selected={data.filters.status === s}>{STATUS_LABEL[s]}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span>担当者</span>
			<select class="input" name="assignee">
				<option value="">すべて</option>
				<option value="none" selected={data.filters.assigneeId === 'none'}>未割り当て</option>
				{#each data.assignees as u (u.id)}<option value={u.id} selected={data.filters.assigneeId === u.id}>{u.name}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span>優先度</span>
			<select class="input" name="priority">
				<option value="">すべて</option>
				{#each PRIORITIES as p (p)}<option value={p} selected={data.filters.priority === p}>{PRIORITY_LABEL[p]}</option>{/each}
			</select>
		</label>
		<button class="btn">絞り込み</button>
	</form>
	{#if !data.project.archivedAt}
		<a href={`/projects/${data.project.key}/issues/new`} class="btn-primary ml-auto"><Plus size={16} />新規課題</a>
	{/if}
</div>

{#if data.issues.length === 0}
	<p class="text-sm text-gray-600">課題はありません。</p>
{:else}
	<table class="w-full bg-white text-sm">
		<thead class="text-left text-gray-500">
			<tr><th class="p-2">番号</th><th class="p-2">タイトル</th><th class="p-2">ステータス</th><th class="p-2">優先度</th><th class="p-2">担当者</th><th class="p-2">期限</th></tr>
		</thead>
		<tbody>
			{#each data.issues as i (i.id)}
				<tr class="border-t border-gray-200">
					<td class="p-2 text-gray-500">{data.project.key}-{i.number}</td>
					<td class="p-2"><a href={`/projects/${data.project.key}/issues/${i.number}`} class="text-blue-700 hover:underline">{i.title}</a></td>
					<td class="p-2">{STATUS_LABEL[i.status]}</td>
					<td class="p-2">{PRIORITY_LABEL[i.priority]}</td>
					<td class="p-2">{i.assigneeName ?? '—'}</td>
					<td class="p-2">{i.dueDate ?? '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
```

- [ ] **Step 5: 課題の起票**

`apps/web/src/routes/projects/[key]/issues/new/+page.server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authz';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { createIssue } from '$lib/server/services/issues';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const canAssign = can(ctx.actor, 'issue:assign');
		return { canAssign, assignees: canAssign ? await listAssignableUsers(ctx.db, p.id) : [] };
	});
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { number } = await createIssue(appContext(locals), params.key, input);
			redirect(303, `/projects/${params.key}/issues/${number}`);
		});
	}
};
```

`apps/web/src/routes/projects/[key]/issues/new/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { PRIORITIES, PRIORITY_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h2 class="mb-4 text-xl font-bold">新規課題</h2>
<form method="POST" use:enhance class="card max-w-2xl space-y-4">
	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
	<label class="block">
		<span class="text-sm">タイトル</span>
		<input class="input" name="title" required maxlength="200" />
	</label>
	<label class="block">
		<span class="text-sm">説明（Markdown）</span>
		<textarea class="input" name="description" rows="8"></textarea>
	</label>
	<div class="grid gap-4 md:grid-cols-3">
		<label class="block">
			<span class="text-sm">優先度</span>
			<select class="input" name="priority">
				{#each PRIORITIES as p (p)}<option value={p}>{PRIORITY_LABEL[p]}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span class="text-sm">期限</span>
			<input class="input" type="date" name="dueDate" />
		</label>
		{#if data.canAssign}
			<label class="block">
				<span class="text-sm">担当者</span>
				<select class="input" name="assigneeId">
					<option value="">未割り当て</option>
					{#each data.assignees as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
			</label>
		{/if}
	</div>
	<button class="btn-primary">起票する</button>
</form>
```

- [ ] **Step 6: 課題の詳細**

`apps/web/src/routes/projects/[key]/issues/[number]/+page.server.ts`:
```ts
import { error, redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authz';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { renderMarkdown } from '$lib/server/markdown';
import { addComment, deleteComment, editComment, listComments } from '$lib/server/services/comments';
import { deleteIssue, getIssue, updateIssue } from '$lib/server/services/issues';
import { listAssignableUsers } from '$lib/server/services/projects';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

function issueNumber(raw: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) error(404, 'Not found');
	return n;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	const number = issueNumber(params.number);
	return handleLoad(async () => {
		const { project, issue } = await getIssue(ctx, params.key, number);
		const [comments, assignees] = await Promise.all([
			listComments(ctx, params.key, number),
			listAssignableUsers(ctx.db, project.id)
		]);
		const res = { reporterId: issue.reporterId, assigneeId: issue.assigneeId };
		const writable = !project.archivedAt;
		return {
			issue: { ...issue, descriptionHtml: renderMarkdown(issue.description) },
			comments: comments.map((c) => ({
				...c,
				html: renderMarkdown(c.body),
				canModify: writable && can(ctx.actor, 'comment:modify', { authorId: c.authorId })
			})),
			assignees,
			perms: {
				writable,
				edit: writable && can(ctx.actor, 'issue:edit', res),
				changeStatus: writable && can(ctx.actor, 'issue:changeStatus', res),
				assign: writable && can(ctx.actor, 'issue:assign', res),
				delete: writable && can(ctx.actor, 'issue:delete', res)
			}
		};
	});
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await updateIssue(appContext(locals), params.key, issueNumber(params.number), input);
			return { saved: true };
		});
	},
	delete: async ({ locals, params }) =>
		handleAction(async () => {
			await deleteIssue(appContext(locals), params.key, issueNumber(params.number));
			redirect(303, `/projects/${params.key}`);
		}),
	comment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await addComment(appContext(locals), params.key, issueNumber(params.number), input);
			return { commented: true };
		});
	},
	editComment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await editComment(appContext(locals), params.key, issueNumber(params.number), input.commentId ?? '', input);
		});
	},
	deleteComment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await deleteComment(appContext(locals), params.key, issueNumber(params.number), input.commentId ?? '');
		});
	}
};
```

`apps/web/src/routes/projects/[key]/issues/[number]/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const issue = $derived(data.issue);
	const perms = $derived(data.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
</script>

<article class="space-y-6">
	<header>
		<p class="text-sm text-gray-500">{data.project.key}-{issue.number}</p>
		<h2 class="text-xl font-bold">{issue.title}</h2>
		<p class="text-xs text-gray-500">起票: {issue.reporterName}</p>
	</header>

	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}

	<form
		method="POST"
		action="?/update"
		use:enhance={() =>
			async ({ update, result }) => {
				await update({ reset: false });
				if (result.type === 'success') editing = false;
			}}
		class="card grid gap-4 md:grid-cols-4"
	>
		<label class="block text-sm">
			<span>ステータス</span>
			<select class="input" name="status" disabled={!perms.changeStatus}>
				{#each STATUSES as s (s)}<option value={s} selected={s === issue.status}>{STATUS_LABEL[s]}</option>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>優先度</span>
			<select class="input" name="priority" disabled={!perms.edit}>
				{#each PRIORITIES as p (p)}<option value={p} selected={p === issue.priority}>{PRIORITY_LABEL[p]}</option>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>担当者</span>
			<select class="input" name="assigneeId" disabled={!perms.assign}>
				<option value="">未割り当て</option>
				{#each data.assignees as u (u.id)}<option value={u.id} selected={u.id === issue.assigneeId}>{u.name}</option>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>期限</span>
			<input class="input" type="date" name="dueDate" value={issue.dueDate ?? ''} disabled={!perms.edit} />
		</label>
		{#if editing}
			<label class="block text-sm md:col-span-4">
				<span>タイトル</span>
				<input class="input" name="title" required maxlength="200" value={issue.title} />
			</label>
			<label class="block text-sm md:col-span-4">
				<span>説明（Markdown）</span>
				<textarea class="input" name="description" rows="10" value={issue.description}></textarea>
			</label>
		{/if}
		{#if canSave}
			<div class="flex gap-2 md:col-span-4">
				<button class="btn-primary">保存</button>
				{#if perms.edit && !editing}
					<button type="button" class="btn" onclick={() => (editing = true)}><Pencil size={14} />タイトル・説明を編集</button>
				{/if}
				{#if form?.saved}<span class="self-center text-sm text-green-700">保存しました</span>{/if}
			</div>
		{/if}
	</form>

	{#if !editing}
		<section class="card">
			{#if issue.description}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
				<div class="markdown">{@html issue.descriptionHtml}</div>
			{:else}
				<p class="text-sm text-gray-500">説明はありません。</p>
			{/if}
		</section>
	{/if}

	<section class="space-y-3">
		<h3 class="font-semibold">コメント</h3>
		{#each data.comments as c (c.id)}
			<div class="card">
				<p class="mb-1 text-xs text-gray-500">{c.authorName} · {c.createdAt.toLocaleString('ja-JP')}</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
				<div class="markdown">{@html c.html}</div>
				{#if c.canModify}
					<div class="mt-2 flex items-start gap-2">
						<details class="flex-1">
							<summary class="cursor-pointer text-xs text-gray-600">編集</summary>
							<form method="POST" action="?/editComment" use:enhance class="mt-2 space-y-2">
								<input type="hidden" name="commentId" value={c.id} />
								<textarea class="input" name="body" rows="4" required value={c.body}></textarea>
								<button class="btn">更新</button>
							</form>
						</details>
						<form method="POST" action="?/deleteComment" use:enhance={({ cancel }) => { if (!confirm('コメントを削除しますか？')) cancel(); }}>
							<input type="hidden" name="commentId" value={c.id} />
							<button class="text-xs text-red-600">削除</button>
						</form>
					</div>
				{/if}
			</div>
		{/each}
		{#if perms.writable}
			<form method="POST" action="?/comment" use:enhance class="space-y-2">
				<label class="block text-sm">
					<span>コメントを追加</span>
					<textarea class="input" name="body" rows="4" required></textarea>
				</label>
				<button class="btn-primary">コメントする</button>
			</form>
		{/if}
	</section>

	{#if perms.delete}
		<form method="POST" action="?/delete" use:enhance={({ cancel }) => { if (!confirm('この課題を削除しますか？')) cancel(); }}>
			<button class="btn text-red-600"><Trash2 size={14} />課題を削除</button>
		</form>
	{/if}
</article>
```

- [ ] **Step 7: プロジェクト設定**

`apps/web/src/routes/projects/[key]/settings/+page.server.ts`:
```ts
import { error } from '@sveltejs/kit';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import {
	createInvitation,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from '$lib/server/services/invitations';
import {
	addMember,
	listMembers,
	removeMember,
	requireProject,
	setProjectArchived,
	updateProject
} from '$lib/server/services/projects';
import { listUsers } from '$lib/server/services/users';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	if (ctx.actor.role !== 'admin') error(404, 'Not found');
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [members, users, invitations] = await Promise.all([
			listMembers(ctx, params.key),
			listUsers(ctx),
			listPendingInvitations(ctx, { projectId: p.id })
		]);
		const memberIds = new Set(members.map((m) => m.id));
		const candidates = users.filter((u) => !u.disabledAt && u.role !== 'admin' && !memberIds.has(u.id));
		return { members, candidates, invitations };
	});
};

const idOf = async (request: Request) => String((await request.formData()).get('id') ?? '');

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await updateProject(appContext(locals), params.key, input);
			return { saved: true };
		});
	},
	archive: async ({ request, locals, params }) => {
		const archived = (await request.formData()).get('archived') === 'true';
		return handleAction(async () => {
			await setProjectArchived(appContext(locals), params.key, archived);
		});
	},
	addMember: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await addMember(appContext(locals), params.key, id);
		});
	},
	removeMember: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await removeMember(appContext(locals), params.key, id);
		});
	},
	inviteGuest: async ({ request, locals, params }) => {
		const email = String((await request.formData()).get('email') ?? '');
		return handleAction(async () => {
			const ctx = appContext(locals);
			const p = await requireProject(ctx, params.key);
			const { url } = await createInvitation(ctx, { email, role: 'guest', projectId: p.id });
			return { inviteUrl: url };
		});
	},
	reissue: async ({ request, locals }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			const { url } = await reissueInvitation(appContext(locals), id);
			return { inviteUrl: url };
		});
	},
	revoke: async ({ request, locals }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await revokeInvitation(appContext(locals), id);
		});
	}
};
```

`apps/web/src/routes/projects/[key]/settings/+page.svelte`:
```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<div class="grid gap-6 md:grid-cols-2">
	<form method="POST" action="?/update" use:enhance={() => async ({ update }) => update({ reset: false })} class="card space-y-4">
		<h2 class="font-semibold">プロジェクト情報</h2>
		<label class="block text-sm">
			<span>プロジェクト名</span>
			<input class="input" name="name" required maxlength="100" value={data.project.name} />
		</label>
		<label class="block text-sm">
			<span>説明（Markdown）</span>
			<textarea class="input" name="description" rows="4" value={data.project.description}></textarea>
		</label>
		<button class="btn-primary">保存</button>
		{#if form?.saved}<span class="text-sm text-green-700">保存しました</span>{/if}
	</form>

	<section class="card space-y-4">
		<h2 class="font-semibold">ゲストを招待</h2>
		<form method="POST" action="?/inviteGuest" use:enhance class="flex items-end gap-2">
			<label class="block flex-1 text-sm">
				<span>ゲストのメールアドレス</span>
				<input class="input" name="email" type="email" required />
			</label>
			<button class="btn-primary">ゲストを招待</button>
		</form>
		{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
		{#each data.invitations as inv (inv.id)}
			<div class="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 text-sm">
				<span>{inv.email}</span>
				{#if inv.expired}<span class="text-red-600">期限切れ</span>{/if}
				<form method="POST" action="?/reissue" use:enhance class="ml-auto flex items-center gap-2">
					<input type="hidden" name="id" value={inv.id} />
					<span class="text-xs text-gray-600">コピーすると招待を再発行し、以前のリンクは無効になります</span>
					<button class="btn">リンクをコピー</button>
				</form>
				<form method="POST" action="?/revoke" use:enhance>
					<input type="hidden" name="id" value={inv.id} />
					<button class="btn">取り消し</button>
				</form>
			</div>
		{/each}
	</section>

	<section class="card space-y-4 md:col-span-2">
		<h2 class="font-semibold">参加者</h2>
		<p class="text-xs text-gray-600">管理者は全プロジェクトに参加しています。</p>
		<ul class="space-y-1 text-sm">
			{#each data.members as m (m.id)}
				<li class="flex items-center gap-2">
					<span>{m.name}</span><span class="text-gray-500">{ROLE_LABEL[m.role]}</span>
					<form method="POST" action="?/removeMember" use:enhance class="ml-auto">
						<input type="hidden" name="id" value={m.id} />
						<button class="text-xs text-red-600">外す</button>
					</form>
				</li>
			{/each}
		</ul>
		{#if data.candidates.length > 0}
			<form method="POST" action="?/addMember" use:enhance class="flex items-end gap-2">
				<label class="block flex-1 text-sm">
					<span>追加するユーザー</span>
					<select class="input" name="id">
						{#each data.candidates as u (u.id)}<option value={u.id}>{u.name}（{ROLE_LABEL[u.role]}）</option>{/each}
					</select>
				</label>
				<button class="btn">追加</button>
			</form>
		{/if}
	</section>

	<form method="POST" action="?/archive" use:enhance class="card md:col-span-2">
		<input type="hidden" name="archived" value={data.project.archivedAt ? 'false' : 'true'} />
		<button class="btn">{data.project.archivedAt ? 'アーカイブを解除' : 'アーカイブする'}</button>
	</form>
</div>
```

- [ ] **Step 8: 手動で動作確認**

`pnpm db:local` と `pnpm dev` を起動した状態で、admin で次を確認する:
1. 新規プロジェクト `ACME` を作成 → `/projects/ACME` に遷移
2. `/admin/users` でメンバーを招待（参加プロジェクト ACME）→ 招待リンクが表示される、ターミナルに `[mail]` ログ
3. 未使用の招待の「リンクをコピー」の横に「コピーすると招待を再発行し、以前のリンクは無効になります」が見えている。押すと新しいリンクが表示され、古いリンクを開くと「招待リンクが無効です」
4. 別ブラウザ（シークレットウィンドウ）で招待リンクから登録 → ACME が見える
5. 課題を起票 → 詳細でステータス・担当者を変更して保存、コメントの投稿・編集・削除
6. 設定でゲスト招待、参加者の追加・削除、アーカイブ（アーカイブ中は起票ボタンが消え、編集できない）

Run: `pnpm lint && pnpm check && pnpm test:unit --run`
Expected: すべて成功

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): add admin, project, issue and settings pages"
```

---

### Task 11: カンバンボード

**Files:**
- Create: `apps/web/src/routes/projects/[key]/board/+page.server.ts`, `+page.svelte`

**Interfaces:**
- Consumes: `listBoard`, `moveIssue`, `IssueListItem`
- Produces: `data-testid="column-<status>"`（`<section>`）、`data-testid="card-<number>"`（`<li>`）— E2E が依存

- [ ] **Step 1: サーバー側**

`apps/web/src/routes/projects/[key]/board/+page.server.ts`:
```ts
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { listBoard, moveIssue } from '$lib/server/services/issues';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => ({ columns: await listBoard(ctx, params.key) }));
};

export const actions: Actions = {
	move: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await moveIssue(appContext(locals), params.key, input);
			return { moved: true };
		});
	}
};
```

- [ ] **Step 2: 画面**

`apps/web/src/routes/projects/[key]/board/+page.svelte`:
```svelte
<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Status } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Columns = typeof data.columns;
	type Card = Columns[Status][number];

	const clone = (c: Columns): Columns =>
		Object.fromEntries(STATUSES.map((s) => [s, [...c[s]]])) as Columns;

	let columns = $derived(clone(data.columns));
	let snapshot: Columns | null = null;
	let message = $state<string | null>(null);

	function consider(status: Status, e: CustomEvent<DndEvent<Card>>) {
		snapshot ??= clone(columns);
		columns = { ...columns, [status]: e.detail.items };
	}

	async function finalize(status: Status, e: CustomEvent<DndEvent<Card>>) {
		const items = e.detail.items;
		columns = { ...columns, [status]: items };
		const idx = items.findIndex((i) => i.id === e.detail.info.id);
		if (idx === -1) return; // 移動元の列。移動先の列の finalize で送信する
		const before = snapshot;
		snapshot = null;

		const fd = new FormData();
		fd.set('issueId', String(e.detail.info.id));
		fd.set('status', status);
		fd.set('beforeId', items[idx - 1]?.id ?? '');
		fd.set('afterId', items[idx + 1]?.id ?? '');
		const res = await fetch('?/move', {
			method: 'POST',
			body: fd,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await res.text());
		if (result.type === 'success') {
			message = null;
			await invalidateAll();
			return;
		}
		if (before) columns = before;
		message =
			result.type === 'failure' && typeof result.data?.message === 'string'
				? result.data.message
				: 'この課題は移動できません';
	}
</script>

{#if message}<p role="alert" class="mb-4 text-sm text-red-600">{message}</p>{/if}

<div class="grid grid-cols-1 gap-4 md:grid-cols-4">
	{#each STATUSES as status (status)}
		<section class="rounded bg-gray-100 p-2" data-testid={`column-${status}`} aria-label={STATUS_LABEL[status]}>
			<h3 class="mb-2 px-1 text-sm font-semibold">
				{STATUS_LABEL[status]} <span class="text-gray-500">{columns[status].length}</span>
			</h3>
			<ul
				class="min-h-24 space-y-2"
				use:dndzone={{
					items: columns[status],
					flipDurationMs: 150,
					type: 'issue',
					dragDisabled: !!data.project.archivedAt
				}}
				onconsider={(e) => consider(status, e)}
				onfinalize={(e) => finalize(status, e)}
			>
				{#each columns[status] as card (card.id)}
					<li class="card cursor-grab p-3 text-sm" data-testid={`card-${card.number}`}>
						<a href={`/projects/${data.project.key}/issues/${card.number}`} class="text-xs text-gray-500 hover:underline">
							{data.project.key}-{card.number}
						</a>
						<p class="font-medium">{card.title}</p>
						<p class="mt-1 flex gap-2 text-xs text-gray-500">
							<span>{card.assigneeName ?? '未割り当て'}</span>
							{#if card.priority !== 'none'}<span>優先度: {PRIORITY_LABEL[card.priority]}</span>{/if}
							{#if card.dueDate}<span>期限: {card.dueDate}</span>{/if}
						</p>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
```

`pnpm check` が `onconsider` / `onfinalize` を未知の属性としてエラーにする場合**だけ**、`apps/web/src/dnd.d.ts` を追加する:
```ts
import type { DndEvent } from 'svelte-dnd-action';

declare module 'svelte/elements' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface HTMLAttributes<T> {
		onconsider?: (event: CustomEvent<DndEvent<{ id: string }>>) => void;
		onfinalize?: (event: CustomEvent<DndEvent<{ id: string }>>) => void;
	}
}

export {};
```
（ライブラリ側が既に型を提供していてこのファイルが二重定義エラーになる場合は追加しない。）

- [ ] **Step 3: 手動で動作確認**

`pnpm dev` で次を確認する:
1. member で課題をドラッグして列を移動・並び替え → 再読み込みしても順序が保たれる
2. 2 つのブラウザで同じボードを開き、片方で課題を別の列へ動かした後、もう片方の古い画面でその課題の隣に別の課題をドロップ →「並び順が古くなっています…」が表示され、カードが元の位置に戻る
3. guest で担当外の課題をドラッグ →「この課題は移動できません」が表示され元に戻る。担当の課題は移動できる

Run: `pnpm lint && pnpm check`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add kanban board with drag and drop"
```

---

### Task 12: E2E テスト

**Files:**
- Create: `apps/web/scripts/e2e-server.sh`, `apps/web/e2e/main-flow.spec.ts`
- Modify: `apps/web/playwright.config.ts`, `apps/web/eslint.config.js`（不要なら変更なし）

**Interfaces:**
- Consumes: Task 9〜11 の画面の文言と `data-testid`

- [ ] **Step 1: E2E 用サーバー起動スクリプト**

`apps/web/scripts/e2e-server.sh`:
```bash
#!/usr/bin/env bash
# E2E 用: 空の libSQL を起動 → マイグレーション → ビルド → wrangler dev（本番に近い実行環境）
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL=http://127.0.0.1:8081
rm -f e2e.db e2e.db-*
turso dev --db-file e2e.db --port 8081 &
TURSO_PID=$!
trap 'kill $TURSO_PID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
	if TURSO_DATABASE_URL=$DB_URL pnpm exec drizzle-kit migrate >/dev/null 2>&1; then break; fi
	if [ "$i" = 40 ]; then echo "migration failed" >&2; exit 1; fi
	sleep 0.5
done

pnpm build
pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port 4173 \
	--var TURSO_DATABASE_URL:$DB_URL \
	--var BETTER_AUTH_SECRET:e2e-secret-e2e-secret-e2e-secret-0123 \
	--var BETTER_AUTH_URL:http://localhost:4173 \
	--var MAIL_PROVIDER:console &
WRANGLER_PID=$!
trap 'kill $WRANGLER_PID $TURSO_PID 2>/dev/null || true' EXIT
wait $WRANGLER_PID
```
`chmod +x apps/web/scripts/e2e-server.sh`

ローカルに `.dev.vars` があっても `--var` の値が優先されることを、Step 4 の実行ログ（`Using vars defined in ...` 等）で確認する。優先されない場合は、スクリプトの先頭で `.dev.vars` を一時退避して `trap` で戻す。

- [ ] **Step 2: Playwright 設定**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	timeout: 60_000,
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'bash scripts/e2e-server.sh',
		url: 'http://localhost:4173/login',
		timeout: 240_000,
		reuseExistingServer: false,
		env: { WRANGLER_SEND_METRICS: 'false' }
	}
});
```

- [ ] **Step 3: シナリオを書く**

`apps/web/e2e/main-flow.spec.ts`:
```ts
import { expect, test, type Locator, type Page } from '@playwright/test';

const PW = 'password-1234';
const HOME = /localhost:4173\/$/;

async function logout(page: Page) {
	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL(/\/login/);
}

async function login(page: Page, email: string) {
	await page.goto('/login');
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await expect(page).toHaveURL(HOME);
}

async function acceptInvite(page: Page, url: string, name: string) {
	await page.goto(url);
	await page.getByLabel('名前').fill(name);
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: '登録する' }).click();
	await expect(page).toHaveURL(HOME);
	await expect(page.getByRole('link', { name })).toBeVisible();
}

async function dragTo(page: Page, source: Locator, target: Locator) {
	const s = await source.boundingBox();
	const t = await target.boundingBox();
	if (!s || !t) throw new Error('drag source or target is not visible');
	await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
	await page.mouse.down();
	await page.mouse.move(s.x + s.width / 2 + 10, s.y + s.height / 2 + 10, { steps: 5 });
	await page.mouse.move(t.x + t.width / 2, t.y + 30, { steps: 20 });
	await page.mouse.up();
}

test('招待 → ゲスト起票 → 担当割り当て → カンバン移動 → コメント', async ({ page }) => {
	// 1. 初期セットアップ
	await page.goto('/login');
	await expect(page).toHaveURL(/\/setup/);
	await page.getByLabel('名前').fill('管理者');
	await page.getByLabel('メールアドレス').fill('admin@example.com');
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: 'セットアップを完了' }).click();
	await expect(page.getByRole('heading', { name: 'プロジェクト' })).toBeVisible();

	// 2. プロジェクト作成
	await page.getByRole('link', { name: '新規プロジェクト' }).click();
	await page.getByLabel('キー').fill('ACME');
	await page.getByLabel('プロジェクト名').fill('ACME サイト改修');
	await page.getByRole('button', { name: '作成' }).click();
	await expect(page.getByRole('heading', { name: 'ACME サイト改修' })).toBeVisible();

	// 3. メンバー招待
	await page.goto('/admin/users');
	await page.getByLabel('メールアドレス').fill('member@example.com');
	await page.getByLabel('ロール').selectOption('member');
	await page.getByLabel('参加プロジェクト').selectOption({ label: 'ACME サイト改修' });
	await page.getByRole('button', { name: '招待する' }).click();
	const memberUrl = await page.getByLabel('招待リンク').inputValue();
	expect(memberUrl).toContain('/invite/');

	// 4. ゲスト招待（プロジェクト設定から）
	await page.goto('/projects/ACME/settings');
	await page.getByLabel('ゲストのメールアドレス').fill('guest@example.com');
	await page.getByRole('button', { name: 'ゲストを招待' }).click();
	const guestUrl = await page.getByLabel('招待リンク').inputValue();
	await logout(page);

	// 5. ゲストが登録して起票
	await acceptInvite(page, guestUrl, '顧客 太郎');
	await page.getByRole('link', { name: /ACME サイト改修/ }).click();
	await page.getByRole('link', { name: '新規課題' }).click();
	await page.getByLabel('タイトル').fill('ログインできない');
	await page.getByRole('button', { name: '起票する' }).click();
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByText('ACME-1')).toBeVisible();
	await logout(page);

	// 6. メンバーが登録し、ゲストを担当者にする
	await acceptInvite(page, memberUrl, '開発 花子');
	await page.goto('/projects/ACME/issues/1');
	await page.getByLabel('担当者').selectOption({ label: '顧客 太郎' });
	await page.getByRole('button', { name: '保存' }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('担当者').locator('option:checked')).toHaveText('顧客 太郎');
	await logout(page);

	// 7. ゲストがカンバンで進行中へ移動
	await login(page, 'guest@example.com');
	await page.goto('/projects/ACME/board');
	await dragTo(
		page,
		page.getByTestId('card-1'),
		page.getByTestId('column-in_progress').locator('ul')
	);
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();

	// 8. ゲストがコメント
	await page.goto('/projects/ACME/issues/1');
	await page.getByLabel('コメントを追加').fill('確認しました');
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();
});
```

- [ ] **Step 4: 実行**

Run: `cd apps/web && pnpm exec playwright install chromium && pnpm test:e2e`
Expected: 1 passed

失敗した場合は `pnpm exec playwright show-trace test-results/**/trace.zip` で原因を確認する。ドラッグ（手順 7）だけが不安定な場合は、`dragTo` の `steps` を増やす・`mouse.down()` の後に `page.waitForTimeout(100)` を入れる、の順で試す。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): add main invitation-to-kanban flow"
```

---

### Task 13: ドキュメントサイト（Astro Starlight）

**Files:**
- Create (scaffold): `apps/docs/**`
- Modify: `apps/docs/astro.config.mjs`, `apps/docs/package.json`
- Create: `apps/docs/wrangler.jsonc`
- Create: `apps/docs/src/content/docs/index.mdx` と `guides/*.md`, `reference/*.md`, `contributing/*.md`（下記）
- Delete: scaffold のサンプルページ（`guides/example.md`, `reference/example.md`）

- [ ] **Step 1: 生成**

```bash
pnpm create astro@latest apps/docs -- --template starlight --no-install --no-git --no-ai --yes
pnpm install
```
`apps/docs/package.json` の `name` を `docs` にし、`scripts` に `"deploy": "astro build && wrangler deploy"` を追加し、`pnpm --filter docs add -D wrangler` を実行する。

- [ ] **Step 2: 設定**

`apps/docs/astro.config.mjs`:
```js
// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	integrations: [
		starlight({
			title: 'Project Manager',
			defaultLocale: 'root',
			locales: { root: { label: '日本語', lang: 'ja' } },
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '必要なもの', slug: 'guides/requirements' },
						{ label: 'デプロイ手順', slug: 'guides/deploy' },
						{ label: 'メール送信の設定', slug: 'guides/mail' },
						{ label: 'アップデート', slug: 'guides/update' }
					]
				},
				{
					label: 'リファレンス',
					items: [
						{ label: '権限', slug: 'reference/permissions' },
						{ label: '環境変数', slug: 'reference/env' }
					]
				},
				{
					label: '開発に参加する',
					items: [
						{ label: 'ローカル開発', slug: 'contributing/local-dev' },
						{ label: 'このドキュメントの公開', slug: 'contributing/docs-hosting' }
					]
				}
			]
		})
	]
});
```

`apps/docs/wrangler.jsonc`:
```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "project-manager-docs",
	"compatibility_date": "2026-10-09",
	"assets": { "directory": "./dist" }
}
```

`apps/docs/.gitignore` に `.wrangler` が無ければ追加する。

- [ ] **Step 3: ページを書く**

`apps/docs/src/content/docs/index.mdx`:
```mdx
---
title: Project Manager
description: 受託開発会社と顧客が課題を共有する、セルフホスト型のプロジェクト管理ツール
template: splash
hero:
  tagline: Cloudflare Workers と Turso で動く、受託開発のための軽量プロジェクト管理ツール（MIT ライセンス）
  actions:
    - text: 必要なものを確認する
      link: /guides/requirements/
      icon: right-arrow
---

## できること

- **課題管理** — 課題番号（`ACME-12` 形式）、ステータス、優先度、担当者、期限
- **カンバン** — ドラッグで列の移動と並び替え
- **コメント** — Markdown で書ける
- **顧客ゲスト** — 顧客を「ゲスト」として招待し、参加しているプロジェクトだけを見せる。ゲストは起票とコメント、自分が起票した課題の編集、自分が担当の課題のステータス変更ができる
- **招待メール / パスワードリセット** — SMTP2GO または Resend の無料枠で送信。メール設定なしでも招待リンクを手渡しできる

利用者ごとに自分の Cloudflare アカウントへデプロイして使います（SaaS としての提供はありません）。
```

`apps/docs/src/content/docs/guides/requirements.md`:
```md
---
title: 必要なもの
---

## アカウント

| サービス | 必須 | 用途 | 費用 |
|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | **必須** | アプリの実行環境（Workers） | 無料プランあり。下記「Workers のプラン」参照 |
| [Turso](https://turso.tech) | **必須** | データベース（libSQL） | 無料プランあり |
| [SMTP2GO](https://www.smtp2go.com) または [Resend](https://resend.com) | 任意 | 招待メール・パスワードリセットメールの送信 | 無料枠あり（[メール送信の設定](/guides/mail/)） |

**Cloudflare アカウントの作成が必要です。** このツールは Cloudflare Workers 上でのみ動作します。

## Workers のプラン

パスワードのハッシュ化（scrypt）は CPU を多く使います。Workers 無料プランの CPU 時間の上限（1 リクエストあたり 10ms）に収まるかどうかは検証中です。ログインやアカウント登録で「Worker exceeded CPU time limit」エラーが出る場合は、Workers Paid プラン（月額 5 ドル〜）に切り替えてください。

## 手元の PC

- [mise](https://mise.jdx.dev)（Node.js・pnpm・Turso CLI のバージョンをそろえるため）
- Git
```

`apps/docs/src/content/docs/guides/deploy.md`:
```md
---
title: デプロイ手順
---

## 1. ソースを取得してツールを入れる

```bash
git clone <このリポジトリの URL> project-manager
cd project-manager
mise install
pnpm install
```

## 2. Turso にデータベースを作る

```bash
turso auth signup        # 初回のみ。既にアカウントがあれば turso auth login
turso db create project-manager
turso db show project-manager --url      # libsql://... を控える
turso db tokens create project-manager   # トークンを控える
```

## 3. データベースにテーブルを作る

```bash
cd apps/web
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." pnpm db:migrate
```

## 4. Cloudflare にログインしてシークレットを登録する

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put TURSO_DATABASE_URL
pnpm exec wrangler secret put TURSO_AUTH_TOKEN
pnpm exec wrangler secret put BETTER_AUTH_SECRET   # `openssl rand -base64 32` の出力
pnpm exec wrangler secret put BETTER_AUTH_URL      # 公開 URL。例: https://project-manager.<サブドメイン>.workers.dev
```

メールを送る場合は `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` も登録します（[メール送信の設定](/guides/mail/)）。登録しなければ招待リンクは画面に表示されるので、手で相手に渡せます。

初回はまだ Worker が無いので、`secret put` が Worker の作成を確認してきたら「はい」を選びます。`BETTER_AUTH_URL` が分からない場合は、先に手順 5 でデプロイして URL を確認し、登録後にもう一度デプロイします。

## 5. デプロイする

```bash
pnpm deploy
```

表示された URL を開くと初期セットアップ画面（`/setup`）になります。最初の管理者アカウントを作成してください。

独自ドメインを使う場合は Cloudflare ダッシュボードの Workers の「Settings → Domains & Routes」で設定し、`BETTER_AUTH_URL` をその URL に変えて再デプロイします。
```

`apps/docs/src/content/docs/guides/mail.md`:
```md
---
title: メール送信の設定
---

招待メールとパスワードリセットのメールを送るには、SMTP2GO か Resend のどちらかを使います。どちらも HTTP API で送信します。

| | 無料枠（2026-10 時点） |
|---|---|
| SMTP2GO | 月 1,000 通・1 日 200 通 |
| Resend | 月 3,000 通・1 日 100 通（宛先 1 件ごとに 1 通と数える） |

最新の条件は各サービスの料金ページで確認してください。

## 共通の手順

1. サービスに登録し、送信元に使うドメインを認証する（DNS に SPF / DKIM レコードを追加）
2. API キーを発行する
3. シークレットを登録して再デプロイする

```bash
cd apps/web
pnpm exec wrangler secret put MAIL_PROVIDER   # smtp2go または resend
pnpm exec wrangler secret put MAIL_API_KEY
pnpm exec wrangler secret put MAIL_FROM       # 例: Project Manager <noreply@example.com>
pnpm deploy
```

## メールが届かないとき

- 送信に失敗してもアプリの操作自体は成功します。失敗は Workers のログ（ダッシュボードの Observability、または `pnpm exec wrangler tail`）に `invitation mail failed` として出ます。
- 招待は管理画面の「未使用の招待」から「リンクをコピー」でいつでも渡せます。**コピーすると招待を再発行し、以前のリンクは無効になります。**
```

`apps/docs/src/content/docs/guides/update.md`:
```md
---
title: アップデート
---

```bash
git pull
mise install
pnpm install
cd apps/web
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." pnpm db:migrate
pnpm deploy
```

マイグレーションは必ずデプロイの前に実行してください。
```

`apps/docs/src/content/docs/reference/permissions.md`:
```md
---
title: 権限
---

ロールはインスタンス全体で 1 つです。管理者は全プロジェクトに参加しているものとして扱われます。

| 操作 | 管理者 | メンバー（参加プロジェクト） | ゲスト（参加プロジェクト） |
|---|---|---|---|
| ユーザーの招待・無効化 | ○ | × | × |
| プロジェクトの作成・編集・アーカイブ | ○ | × | × |
| 参加者の追加・削除、ゲストの招待 | ○ | × | × |
| プロジェクト・課題・コメントの閲覧 | ○ | ○ | ○ |
| 課題の起票 | ○ | ○ | ○ |
| 課題のタイトル・説明・優先度・期限の編集 | ○ | ○ | 自分が起票した課題のみ |
| 課題のステータス変更（カンバン移動を含む） | ○ | ○ | 自分が担当の課題のみ |
| 課題の担当者変更 | ○ | ○ | × |
| 課題の削除 | ○ | ○ | × |
| コメントの投稿 | ○ | ○ | ○ |
| コメントの編集・削除 | すべて | 自分のもの | 自分のもの |

- 担当者にできるのは、そのプロジェクトの参加者（ゲストを含む）と管理者です。
- 参加していないプロジェクトの URL を開くと「見つかりません」になります。
- アーカイブしたプロジェクトは閲覧のみになります。
```

`apps/docs/src/content/docs/reference/env.md`:
```md
---
title: 環境変数
---

本番では `wrangler secret put` で、ローカルでは `apps/web/.dev.vars` で設定します。

| 名前 | 必須 | 説明 |
|---|---|---|
| `TURSO_DATABASE_URL` | ○ | `libsql://...`（ローカルは `http://127.0.0.1:8080`） |
| `TURSO_AUTH_TOKEN` | 本番は ○ | Turso の DB トークン |
| `BETTER_AUTH_SECRET` | ○ | 32 文字以上のランダム値（`openssl rand -base64 32`） |
| `BETTER_AUTH_URL` | ○ | 公開 URL（例 `https://pm.example.com`） |
| `MAIL_PROVIDER` | - | `smtp2go` / `resend` / `console`。未設定なら `console`（ログに出すだけ） |
| `MAIL_API_KEY` | `MAIL_PROVIDER` が `console` 以外なら ○ | |
| `MAIL_FROM` | `MAIL_PROVIDER` が `console` 以外なら ○ | 例 `Project Manager <noreply@example.com>` |
```

`apps/docs/src/content/docs/contributing/local-dev.md`:
```md
---
title: ローカル開発
---

```bash
mise install
pnpm install
cd apps/web
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を書き換える
pnpm db:local                    # 別ターミナルで起動したまま
pnpm db:migrate
pnpm dev                         # http://localhost:5173
```

## テスト

```bash
pnpm test:unit --run   # services の単体テスト（インメモリ DB）
pnpm test:e2e          # Playwright（turso dev と wrangler dev を自動で起動）
pnpm lint && pnpm check
```

## スキーマを変えたとき

```bash
pnpm db:generate --name <変更内容>
pnpm db:migrate
```

## 構成

- `apps/web/src/lib/server/services/` — 業務ロジックと権限チェック（ここをテストする）
- `apps/web/src/routes/` — 画面。services を呼ぶだけにする
- `apps/web/src/hooks.server.ts` — 認証と、Cloudflare の env の読み込み（`cloudflare:workers` を import するのはここだけ）
```

`apps/docs/src/content/docs/contributing/docs-hosting.md`:
```md
---
title: このドキュメントの公開
---

このドキュメントサイトも Cloudflare Workers（静的アセット）で公開できます。Cloudflare アカウントが必要です。

```bash
cd apps/docs
pnpm exec wrangler login
pnpm deploy
```
```

- [ ] **Step 4: ビルド確認**

Run: `pnpm docs:build`
Expected: 成功し、`apps/docs/dist` に 9 ページ分の HTML ができる。リンク切れの警告が無いこと。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add Starlight documentation site"
```

---

### Task 14: CI と README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: CI**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: jdx/mise-action@v5
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm check
      - run: pnpm test:unit
      - run: pnpm --filter web exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          WRANGLER_SEND_METRICS: 'false'
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: apps/web/test-results
      - run: pnpm docs:build
```

- [ ] **Step 2: README**

`README.md`:
```md
# Project Manager

受託開発会社と顧客（ゲスト）が課題を共有するための、セルフホスト型プロジェクト管理ツールです。Cloudflare Workers と Turso で動きます。

- 課題管理（番号・ステータス・優先度・担当者・期限）とカンバン
- Markdown のコメント
- 顧客をゲストとして招待し、参加プロジェクトだけを見せる

**利用には Cloudflare アカウントと Turso アカウントが必要です。** 手順はドキュメント（`apps/docs`）を参照してください。

## 開発

```bash
mise install && pnpm install
pnpm docs:dev   # ドキュメント
pnpm dev        # アプリ（事前に apps/web で .dev.vars と pnpm db:local が必要）
```

## ライセンス

MIT
```

- [ ] **Step 3: ルートから全体を実行**

Run: `pnpm lint && pnpm check && pnpm test:unit && pnpm test:e2e && pnpm docs:build`
Expected: すべて成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions workflow and README"
```

---

### Task 15: 初回デプロイと CPU 時間の実測（人間のパートナーが実施）

外部サービスへのデプロイなので、エージェントは実行せず、手順を人間のパートナーに渡して結果を受け取る。

- [ ] **Step 1: パートナーにデプロイを依頼する**

`apps/docs/src/content/docs/guides/deploy.md` の手順どおりに、パートナー自身の Cloudflare（**無料プラン**）と Turso にデプロイしてもらう。

- [ ] **Step 2: 実測してもらう**

1. `/setup` で管理者を作成し、ログアウト → ログインを 10 回繰り返す
2. Cloudflare ダッシュボード → Workers → `project-manager` → Metrics で、CPU 時間（P50 / P99）と「Exceeded CPU Time Limits」エラーの有無を確認
3. 結果（P50 / P99 の値、エラーの有無）をエージェントに伝える

- [ ] **Step 3: 結果をドキュメントに反映する**

`apps/docs/src/content/docs/guides/requirements.md` の「Workers のプラン」節を、結果に応じて次のどちらかに書き換える:
- エラーなし・P99 が 10ms 未満: 「無料プランで動作することを確認しています（ログイン時の CPU 時間 P99 = ◯ms、2026-10 計測）。」
- エラーあり、または P99 が 10ms 以上: 「ログインとアカウント登録で無料プランの CPU 上限を超えます（P99 = ◯ms、2026-10 計測）。**Workers Paid プランが必要です。**」と書き、`index.mdx` と README の必要なものにも Paid プランの必要性を追記する。

（◯ には実測値を入れる。）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: record measured CPU time on Workers free plan"
```
