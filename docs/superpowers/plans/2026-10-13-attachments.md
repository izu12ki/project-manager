# ファイル添付（R2） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 課題の説明・コメントにファイルを添付し、画像はインライン表示、それ以外はダウンロードできるようにする。

**Architecture:** ブラウザ → SvelteKit の `+server.ts` → R2 バインディング（`BUCKET`）。メタデータは Turso の `attachment` テーブルに置き、権限は既存 services（`requireProject` / `authorize`）で確認する。アップロード直後は課題に紐付かない「仮置き」で、起票・編集・コメント保存時に本文中の添付 URL から紐付ける。

**Tech Stack:** SvelteKit 3（remote functions, adapter-cloudflare）、Svelte 5、Drizzle 1.0 rc.4（turso dialect）、valibot、vitest、Playwright、Cloudflare R2。

**Spec:** `docs/superpowers/specs/2026-10-13-attachments-design.md`

## Global Constraints

- 1 ファイル最大 25MB（`25 * 1024 * 1024` バイト。ちょうどは可、超過は不可）。空ファイルは不可。種類は問わない。
- インライン表示（`Content-Disposition: inline`）してよいのは `image/png` / `image/jpeg` / `image/gif` / `image/webp` だけ。それ以外（SVG・HTML を含む）は `application/octet-stream` + `attachment`。
- 配信は常に `X-Content-Type-Options: nosniff` と `Cache-Control: private, max-age=3600`。
- R2 のキーは `<projectId>/<attachmentId>`。バケット名 `project-manager-attachments`、バインディング名 `BUCKET`。
- 削除できるのはアップロードした本人と admin。アップロードは全ロール（アーカイブ中は不可）。
- 未参加プロジェクト・他プロジェクトの添付は 404（`not_found`）。
- 仮置きは 24 時間で掃除。cron は使わず、アップロード時に `waitUntil` で本人の分を消す。
- Markdown は `html: false` のまま変えない。
- コマンドはすべて `apps/web` で実行する。コミットメッセージは `feat(web): ...` / `docs: ...` 形式。

## Review Focus

1. **日本語や `()[]` を含むファイル名**（`仕様書 (最終) [v2].pdf`）。期待する動作は、ダウンロード時に元の名前で保存され、本文に入る Markdown リンクも壊れないこと。テスト: Task 3 の `downloadHeaders`、Task 5 の `markdownFor`。
2. **テキストの普通の貼り付け**。期待する動作は、ファイルを含まない貼り付けではアップロード処理が動かず、ブラウザ標準の貼り付けになること。テスト: Task 5 の E2E（`defaultPrevented` が false）。
3. **他の課題に紐付き済みの添付 URL を別の課題の本文に貼った場合**。期待する動作は、紐付けが移らず元の課題に残り、表示はできること。テスト: Task 2。
4. **アップロード後に起票せず離脱した場合**。期待する動作は、24 時間後の次のアップロード時に行と R2 の実体が消え、他人の仮置きには触れないこと。テスト: Task 1。
5. **アーカイブ済みプロジェクトでのアップロード・削除**。期待する動作は `conflict` で拒否され、UI に削除ボタンが出ないこと。テスト: Task 1・Task 3、および Task 4 の `canDelete`。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/lib/attachment-rules.ts`（新規） | クライアント・サーバー共通の純粋関数と定数（上限、画像判定、URL、Markdown、サイズ表示） |
| `src/lib/attachment-rules.test.ts`（新規） | 上記のテスト |
| `src/lib/server/attachment-store.ts`（新規） | R2 の薄いインターフェース `AttachmentStore` と、テスト用のインメモリ実装 |
| `src/lib/server/db/schema.ts` | `attachment` テーブル |
| `drizzle/<ts>_attachments/` | マイグレーション（drizzle-kit 生成） |
| `src/lib/server/authz.ts` | `attachment:create` / `attachment:delete` |
| `src/lib/server/context.ts` / `src/hooks.server.ts` / `wrangler.jsonc` | `bucket` の受け渡し |
| `src/lib/server/test-utils.ts` | `createTestBase` に既定のインメモリ store |
| `src/lib/server/services/attachments.ts`（新規） | アップロード・掃除・一覧・取得・削除・配信ヘッダ |
| `src/lib/server/services/attachment-links.ts`（新規） | 本文からの参照抽出と紐付け（issues/comments から使う。循環 import を避けるため分離） |
| `src/lib/server/services/issues.ts` / `comments.ts` | 紐付けの呼び出し、課題削除時の R2 削除 |
| `src/routes/projects/[key]/attachments/+server.ts`（新規） | `POST` アップロード |
| `src/routes/projects/[key]/attachments/[id]/+server.ts`（新規） | `GET` 配信 |
| `src/routes/projects/[key]/issues/[number=int]/issue.remote.ts` | `getAttachments` / `removeAttachment`、各保存後の refresh |
| `src/lib/attachment-upload.ts`（新規） | ブラウザ側のアップロード・挿入・貼り付け/ドロップの attachment |
| `src/lib/components/AttachButton.svelte`（新規） | 「ファイルを添付」ボタン |
| `src/lib/components/MarkdownEditor.svelte` | `projectKey` を受け取り添付を有効化 |
| 課題詳細・新規起票ページ | 添付 UI と添付一覧 |
| `e2e/main-flow.spec.ts` | API と UI の E2E |
| `apps/docs/src/content/docs/...` | 導入・更新・権限ドキュメント |

---

### Task 1: データモデル・ストア・アップロードサービス

**Files:**
- Create: `apps/web/src/lib/attachment-rules.ts`
- Create: `apps/web/src/lib/server/attachment-store.ts`
- Create: `apps/web/src/lib/server/services/attachments.ts`
- Create: `apps/web/src/lib/server/services/attachments.test.ts`
- Modify: `apps/web/src/lib/server/db/schema.ts`（`comment` テーブルの後に追加）
- Modify: `apps/web/src/lib/server/authz.ts`
- Modify: `apps/web/src/lib/server/authz.test.ts`
- Modify: `apps/web/src/lib/server/context.ts`
- Modify: `apps/web/src/lib/server/test-utils.ts`
- Modify: `apps/web/src/hooks.server.ts`
- Modify: `apps/web/wrangler.jsonc`
- Generate: `apps/web/drizzle/<timestamp>_attachments/`

**Interfaces:**
- Produces:
  - `attachment-rules.ts`: `MAX_ATTACHMENT_BYTES: number`, `TOO_LARGE_MESSAGE: string`, `isSafeImage(contentType: string): boolean`, `attachmentUrl(projectKey: string, id: string): string`
  - `attachment-store.ts`: `interface AttachmentStore { put(key, value: Blob, options: { httpMetadata: { contentType: string } }): Promise<unknown>; get(key): Promise<{ body: ReadableStream } | null>; delete(keys: string | string[]): Promise<void> }`, `createMemoryStore(): AttachmentStore & { objects: Map<string, Blob> }`
  - `BaseContext.bucket: AttachmentStore`
  - schema `attachment`（列: `id, projectId, issueId, commentId, uploaderId, filename, contentType, size, r2Key, createdAt`）
  - `authz`: `Action` に `'attachment:create' | 'attachment:delete'`、`Resource.uploaderId?: string`
  - `services/attachments.ts`: `interface UploadResult { id: string; url: string; filename: string; isImage: boolean }`, `uploadAttachment(ctx, key, file: File): Promise<UploadResult>`, `purgeStaleUploads(ctx): Promise<void>`, `sanitizeFilename(name: string): string`, `normalizeContentType(type: string): string`

- [ ] **Step 1: 共通ルールを書く**

`apps/web/src/lib/attachment-rules.ts`:

```ts
/** 添付の上限（25MB）。ちょうどは可。 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = 'ファイルは25MB以下にしてください';

// ブラウザでインライン表示しても安全な画像。SVG はスクリプトを含められるので入れない
const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isSafeImage(contentType: string): boolean {
	return SAFE_IMAGE_TYPES.has(contentType.toLowerCase());
}

export function attachmentUrl(projectKey: string, id: string): string {
	return `/projects/${projectKey}/attachments/${id}`;
}
```

- [ ] **Step 2: ストアのインターフェースとインメモリ実装を書く**

`apps/web/src/lib/server/attachment-store.ts`:

```ts
/** R2Bucket のうちアプリが使う部分。本番は env.BUCKET をそのまま渡す。 */
export interface AttachmentStore {
	put(key: string, value: Blob, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
	get(key: string): Promise<{ body: ReadableStream } | null>;
	delete(keys: string | string[]): Promise<void>;
}

/** テスト用。objects で保存内容を確認できる。 */
export function createMemoryStore(): AttachmentStore & { objects: Map<string, Blob> } {
	const objects = new Map<string, Blob>();
	return {
		objects,
		put: async (key, value) => {
			objects.set(key, value);
			return null;
		},
		get: async (key) => {
			const blob = objects.get(key);
			return blob ? { body: blob.stream() } : null;
		},
		delete: async (keys) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
		}
	};
}
```

- [ ] **Step 3: スキーマを追加する**

`apps/web/src/lib/server/db/schema.ts` の `comment` テーブル定義の直後（`relations` の前）に追加:

```ts
// issueId が null の行は「仮置き」（起票・コメント投稿前にアップロードしたもの）
export const attachment = sqliteTable(
	'attachment',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		issueId: text('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
		commentId: text('comment_id').references(() => comment.id, { onDelete: 'set null' }),
		uploaderId: text('uploader_id')
			.notNull()
			.references(() => user.id),
		filename: text().notNull(),
		contentType: text('content_type').notNull(),
		size: integer().notNull(),
		r2Key: text('r2_key').notNull(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('attachment_r2_key_uq').on(t.r2Key),
		index('attachment_issue_idx').on(t.issueId),
		index('attachment_uploader_idx').on(t.uploaderId, t.issueId)
	]
);
```

- [ ] **Step 4: マイグレーションを生成する**

Run: `cd apps/web && pnpm db:generate --name attachments`
Expected: `drizzle/<timestamp>_attachments/migration.sql` と `snapshot.json` ができる。`migration.sql` に `CREATE TABLE \`attachment\``、3 つのインデックス、`project` / `issue` / `comment` / `user` への外部キーが含まれ、既存テーブルへの変更（`ALTER` / `DROP`）は含まれない。

- [ ] **Step 5: 権限の失敗するテストを書く**

`apps/web/src/lib/server/authz.test.ts` の `table` の末尾（`['comment:modify', { authorId: 'g' }, ...]` の後）に追加:

```ts
	['attachment:create', {}, true, true, true],
	['attachment:delete', { uploaderId: 'x' }, true, false, false],
	['attachment:delete', { uploaderId: 'm' }, true, true, false],
	['attachment:delete', { uploaderId: 'g' }, true, false, true]
```

Run: `pnpm test:unit --run src/lib/server/authz.test.ts`
Expected: 型エラーまたは FAIL（`attachment:create` が `Action` にない）

- [ ] **Step 6: 権限を実装する**

`apps/web/src/lib/server/authz.ts`:

```ts
export type Action =
	| 'user:manage'
	| 'project:manage'
	| 'issue:create'
	| 'issue:edit'
	| 'issue:changeStatus'
	| 'issue:assign'
	| 'issue:delete'
	| 'comment:create'
	| 'comment:modify'
	| 'attachment:create'
	| 'attachment:delete';

export interface Resource {
	reporterId?: string;
	assigneeId?: string | null;
	authorId?: string;
	uploaderId?: string;
}
```

`can` の switch の `case 'issue:create': case 'comment:create':` に `case 'attachment:create':` を加え、末尾に追加:

```ts
		case 'attachment:delete':
			return res.uploaderId === actor.id;
```

Run: `pnpm test:unit --run src/lib/server/authz.test.ts`
Expected: PASS

- [ ] **Step 7: コンテキストに bucket を通す**

`apps/web/src/lib/server/context.ts`: `import type { AttachmentStore } from './attachment-store';` を追加し、`BaseContext` の `mailer` の次に `bucket: AttachmentStore;` を追加する。

`apps/web/src/lib/server/test-utils.ts`: `import { createMemoryStore } from './attachment-store';` を追加し、`createTestBase` の返り値の `mailer` の次に `bucket: createMemoryStore(),` を追加する（`...overrides` より前なので上書きできる）。

`apps/web/wrangler.jsonc` の `"observability"` の行の後に追加:

```jsonc
	// 添付ファイル。バケットは `wrangler r2 bucket create project-manager-attachments` で作る
	"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "project-manager-attachments" }],
```

`apps/web/src/hooks.server.ts` の `event.locals.base = { db, mailer, ...` に `bucket: env.BUCKET,` を `mailer,` の次に追加する。

Run: `pnpm check`
Expected: エラー 0。`wrangler types` で `Env.BUCKET: R2Bucket` が生成され、`R2Bucket` が `AttachmentStore` に代入できる。代入できないという型エラーが出た場合は、`AttachmentStore` のメソッドの引数型を広げて合わせる（例: `get` の戻り値を `{ body: ReadableStream<Uint8Array> } | null` にする）。`hooks.server.ts` でのキャストはしない。

- [ ] **Step 8: アップロードサービスの失敗するテストを書く**

`apps/web/src/lib/server/services/attachments.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '$lib/attachment-rules';
import { createMemoryStore } from '../attachment-store';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { attachment } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	normalizeContentType,
	purgeStaleUploads,
	sanitizeFilename,
	uploadAttachment
} from './attachments';

const file = (name = 'shot.png', size = 4, type = 'image/png') =>
	new File([new Uint8Array(size)], name, { type });

const DAY_AGO = () => new Date(Date.now() - 25 * 60 * 60 * 1000);

describe('attachments: upload', () => {
	let db: DB;
	let store: ReturnType<typeof createMemoryStore>;
	let base: ReturnType<typeof createTestBase>;
	let pending: Promise<unknown>[];
	let member: Actor, guest: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const settle = () => Promise.all(pending.splice(0));
	const ids = async () => (await db.select({ id: attachment.id }).from(attachment)).map((r) => r.id);

	beforeEach(async () => {
		db = await createTestDb();
		store = createMemoryStore();
		pending = [];
		base = createTestBase(db, { bucket: store, waitUntil: (p) => void pending.push(p) });
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'ARCH', members: [member], archived: true });
	});

	it('ゲストもアップロードでき、仮置き（issueId なし）で R2 に保存される', async () => {
		const r = await uploadAttachment(as(guest), 'ACME', file());
		expect(r).toEqual({
			id: r.id,
			url: `/projects/ACME/attachments/${r.id}`,
			filename: 'shot.png',
			isImage: true
		});
		const [row] = await db.select().from(attachment).where(eq(attachment.id, r.id));
		expect(row).toMatchObject({
			issueId: null,
			commentId: null,
			uploaderId: guest.id,
			size: 4,
			contentType: 'image/png'
		});
		expect(row.r2Key).toBe(`${row.projectId}/${r.id}`);
		expect(store.objects.has(row.r2Key)).toBe(true);
	});

	it('25MB ちょうどは可、超えると validation、空ファイルも validation', async () => {
		await expect(
			uploadAttachment(as(member), 'ACME', file('a.bin', MAX_ATTACHMENT_BYTES))
		).resolves.toBeDefined();
		await expect(
			uploadAttachment(as(member), 'ACME', file('b.bin', MAX_ATTACHMENT_BYTES + 1))
		).rejects.toMatchObject({ code: 'validation' });
		await expect(uploadAttachment(as(member), 'ACME', file('c.bin', 0))).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('アーカイブ済みは conflict、未参加は not_found', async () => {
		await expect(uploadAttachment(as(member), 'ARCH', file())).rejects.toMatchObject({
			code: 'conflict'
		});
		await expect(uploadAttachment(as(outsider), 'ACME', file())).rejects.toMatchObject({
			code: 'not_found'
		});
		expect(await ids()).toEqual([]);
	});

	it('R2 への保存に失敗したら行を残さない', async () => {
		const failing = {
			...createMemoryStore(),
			put: async () => {
				throw new Error('r2 down');
			}
		};
		const ctx = ctxOf(createTestBase(db, { bucket: failing }), member);
		await expect(uploadAttachment(ctx, 'ACME', file())).rejects.toThrow('r2 down');
		expect(await ids()).toEqual([]);
	});

	it('SVG と種類不明のファイルは画像扱いしない', async () => {
		const svg = await uploadAttachment(as(member), 'ACME', file('x.svg', 4, 'image/svg+xml'));
		const unknown = await uploadAttachment(as(member), 'ACME', file('x.dat', 4, ''));
		expect(svg.isImage).toBe(false);
		expect(unknown.isImage).toBe(false);
		const [row] = await db.select().from(attachment).where(eq(attachment.id, unknown.id));
		expect(row.contentType).toBe('application/octet-stream');
	});

	it('24時間を過ぎた本人の仮置きだけを掃除する', async () => {
		await uploadAttachment(as(guest), 'ACME', file('old.png'));
		const others = await uploadAttachment(as(member), 'ACME', file('m.png'));
		await settle();
		await db.update(attachment).set({ createdAt: DAY_AGO() });
		await purgeStaleUploads(as(guest));
		expect(await ids()).toEqual([others.id]);
		expect(store.objects.size).toBe(1);
	});

	it('アップロードのたびに本人の古い仮置きが掃除される', async () => {
		const old = await uploadAttachment(as(guest), 'ACME', file('old.png'));
		await settle();
		await db.update(attachment).set({ createdAt: DAY_AGO() }).where(eq(attachment.id, old.id));
		const fresh = await uploadAttachment(as(guest), 'ACME', file('new.png'));
		await settle();
		expect(await ids()).toEqual([fresh.id]);
	});
});

describe('sanitizeFilename', () => {
	it('パス区切りと制御文字を _ にし、空なら file、255 文字で切る', () => {
		expect(sanitizeFilename('../a/b\\c.png')).toBe('.._a_b_c.png');
		expect(sanitizeFilename('a\u0000b\nc')).toBe('a_b_c');
		expect(sanitizeFilename('   ')).toBe('file');
		expect(sanitizeFilename('仕様書 (最終) [v2].pdf')).toBe('仕様書 (最終) [v2].pdf');
		expect(Array.from(sanitizeFilename('あ'.repeat(300)))).toHaveLength(255);
	});
});

describe('normalizeContentType', () => {
	it('パラメータを落として小文字にし、空なら application/octet-stream', () => {
		expect(normalizeContentType('Image/PNG; charset=binary')).toBe('image/png');
		expect(normalizeContentType('')).toBe('application/octet-stream');
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/attachments.test.ts`
Expected: FAIL（`./attachments` が存在しない）

- [ ] **Step 9: アップロードサービスを実装する**

`apps/web/src/lib/server/services/attachments.ts`:

```ts
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
	MAX_ATTACHMENT_BYTES,
	TOO_LARGE_MESSAGE,
	attachmentUrl,
	isSafeImage
} from '$lib/attachment-rules';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { attachment } from '../db/schema';
import { AppError } from '../errors';
import { assertWritable, requireProject } from './projects';

/** 仮置きのまま残す期間 */
const STALE_MS = 24 * 60 * 60 * 1000;

export interface UploadResult {
	id: string;
	url: string;
	filename: string;
	isImage: boolean;
}

/** パス区切り・制御文字を _ にし、255 文字（コードポイント）以内にする */
export function sanitizeFilename(name: string): string {
	// eslint-disable-next-line no-control-regex -- 制御文字を除くための範囲指定
	const cleaned = name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
	return Array.from(cleaned || 'file')
		.slice(0, 255)
		.join('');
}

export function normalizeContentType(type: string): string {
	return type.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

export async function uploadAttachment(
	ctx: AppContext,
	key: string,
	file: File
): Promise<UploadResult> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	authorize(ctx.actor, 'attachment:create');
	if (file.size === 0) throw new AppError('validation', '空のファイルは添付できません');
	if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError('validation', TOO_LARGE_MESSAGE);

	const id = uuidv7();
	const r2Key = `${p.id}/${id}`;
	const filename = sanitizeFilename(file.name);
	const contentType = normalizeContentType(file.type);
	await ctx.db.insert(attachment).values({
		id,
		projectId: p.id,
		uploaderId: ctx.actor.id,
		filename,
		contentType,
		size: file.size,
		r2Key
	});
	try {
		// ReadableStream だと R2 が長さを要求するので、File（Blob）のまま渡す
		await ctx.bucket.put(r2Key, file, { httpMetadata: { contentType } });
	} catch (e) {
		await ctx.db.delete(attachment).where(eq(attachment.id, id));
		throw e;
	}
	ctx.waitUntil(
		purgeStaleUploads(ctx).catch((e) => console.error('attachment purge failed', e))
	);
	return { id, url: attachmentUrl(p.key, id), filename, isImage: isSafeImage(contentType) };
}

/** 本人の、24 時間を過ぎた仮置きを行・R2 とも削除する */
export async function purgeStaleUploads(ctx: AppContext): Promise<void> {
	const rows = await ctx.db
		.select({ id: attachment.id, r2Key: attachment.r2Key })
		.from(attachment)
		.where(
			and(
				eq(attachment.uploaderId, ctx.actor.id),
				isNull(attachment.issueId),
				lt(attachment.createdAt, new Date(Date.now() - STALE_MS))
			)
		);
	if (rows.length === 0) return;
	await ctx.db.delete(attachment).where(
		inArray(
			attachment.id,
			rows.map((r) => r.id)
		)
	);
	await ctx.bucket.delete(rows.map((r) => r.r2Key));
}
```

Run: `pnpm test:unit --run src/lib/server/services/attachments.test.ts`
Expected: PASS

- [ ] **Step 10: 全体を確認してコミットする**

Run: `pnpm check && pnpm lint && pnpm test:unit --run`
Expected: すべて成功（`pnpm lint` で整形エラーが出たら `pnpm format` してから再実行）

```bash
git add apps/web/src/lib/attachment-rules.ts apps/web/src/lib/server/attachment-store.ts \
  apps/web/src/lib/server/services/attachments.ts apps/web/src/lib/server/services/attachments.test.ts \
  apps/web/src/lib/server/db/schema.ts apps/web/drizzle apps/web/src/lib/server/authz.ts \
  apps/web/src/lib/server/authz.test.ts apps/web/src/lib/server/context.ts \
  apps/web/src/lib/server/test-utils.ts apps/web/src/hooks.server.ts apps/web/wrangler.jsonc
git commit -m "feat(web): add attachment table, R2 store and upload service"
```

---

### Task 2: 課題・コメントへの紐付けと一覧

**Files:**
- Create: `apps/web/src/lib/server/services/attachment-links.ts`
- Create: `apps/web/src/lib/server/services/attachment-links.test.ts`
- Modify: `apps/web/src/lib/server/services/issues.ts`（`createIssue` と `updateIssue`）
- Modify: `apps/web/src/lib/server/services/comments.ts`（`addComment` / `findOwnedComment` / `editComment`）
- Modify: `apps/web/src/lib/server/services/attachments.ts`（`listAttachments` を追加）

**Interfaces:**
- Consumes: Task 1 の `uploadAttachment`, `attachment` スキーマ, `createMemoryStore`
- Produces:
  - `attachment-links.ts`: `referencedAttachmentIds(body: string): string[]`, `linkAttachments(ctx: AppContext, target: { projectId: string; issueId: string; commentId?: string }, body: string): Promise<void>`
  - `attachments.ts`: `listAttachments(ctx, key: string, number: number): Promise<{ id: string; filename: string; contentType: string; size: number; uploaderId: string; uploaderName: string; createdAt: Date }[]>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/server/services/attachment-links.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { attachment } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { referencedAttachmentIds } from './attachment-links';
import { listAttachments, uploadAttachment } from './attachments';
import { addComment, deleteComment, editComment, listComments } from './comments';
import { createIssue, getIssue, updateIssue } from './issues';

const png = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/png' });

describe('referencedAttachmentIds', () => {
	it('添付 URL の UUID を重複なく取り出し、それ以外は無視する', () => {
		const a = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
		const b = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
		const body = `![x](/projects/ACME/attachments/${a}) [y](/projects/ACME/attachments/${b})
[again](/projects/ACME/attachments/${a}) /projects/ACME/attachments/not-a-uuid`;
		expect(referencedAttachmentIds(body)).toEqual([a, b]);
	});
});

describe('attachment links', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const issueIdOf = async (n: number) => (await getIssue(as(member), 'ACME', n)).issue.id;
	const rowOf = async (id: string) =>
		(await db.select().from(attachment).where(eq(attachment.id, id)))[0];

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'BETA', members: [member] });
	});

	it('起票時、本文で参照した自分の仮置きだけを紐付ける', async () => {
		const mine = await uploadAttachment(as(guest), 'ACME', png('mine.png'));
		const theirs = await uploadAttachment(as(member), 'ACME', png('theirs.png'));
		await createIssue(as(guest), 'ACME', {
			title: 'A',
			description: `![a](${mine.url}) ![b](${theirs.url})`
		});
		expect((await rowOf(mine.id)).issueId).toBe(await issueIdOf(1));
		expect((await rowOf(theirs.id)).issueId).toBeNull();
	});

	it('別プロジェクトの添付 ID は紐付けない', async () => {
		const beta = await uploadAttachment(as(member), 'BETA', png('b.png'));
		await createIssue(as(member), 'ACME', {
			title: 'A',
			description: `![b](/projects/ACME/attachments/${beta.id})`
		});
		expect((await rowOf(beta.id)).issueId).toBeNull();
	});

	it('他の課題に紐付き済みの添付を参照しても移らない', async () => {
		const a = await uploadAttachment(as(member), 'ACME', png('a.png'));
		await createIssue(as(member), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await createIssue(as(member), 'ACME', { title: 'B', description: `![a](${a.url})` });
		expect((await rowOf(a.id)).issueId).toBe(await issueIdOf(1));
	});

	it('説明の編集で紐付く', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const a = await uploadAttachment(as(member), 'ACME', png('a.png'));
		await updateIssue(as(member), 'ACME', 1, { description: `![a](${a.url})` });
		expect((await rowOf(a.id)).issueId).toBe(await issueIdOf(1));
	});

	it('コメントの投稿・編集で commentId も入り、コメント削除後も課題に残る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const a = await uploadAttachment(as(guest), 'ACME', png('a.png'));
		await addComment(as(guest), 'ACME', 1, { body: `![a](${a.url})` });
		const [c] = await listComments(as(guest), 'ACME', 1);
		expect(await rowOf(a.id)).toMatchObject({ issueId: await issueIdOf(1), commentId: c.id });

		const b = await uploadAttachment(as(guest), 'ACME', png('b.png'));
		await editComment(as(guest), 'ACME', 1, c.id, { body: `![b](${b.url})` });
		expect((await rowOf(b.id)).commentId).toBe(c.id);

		await deleteComment(as(guest), 'ACME', 1, c.id);
		expect(await rowOf(a.id)).toMatchObject({ issueId: await issueIdOf(1), commentId: null });
	});

	it('listAttachments は課題に紐付いた添付をアップロード者名付きで古い順に返す', async () => {
		const a = await uploadAttachment(as(guest), 'ACME', png('a.png'));
		const b = await uploadAttachment(as(member), 'ACME', png('b.png'));
		await uploadAttachment(as(member), 'ACME', png('orphan.png'));
		await createIssue(as(guest), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await addComment(as(member), 'ACME', 1, { body: `[b](${b.url})` });
		const list = await listAttachments(as(member), 'ACME', 1);
		expect(list.map((x) => [x.filename, x.uploaderName])).toEqual([
			['a.png', 'guest'],
			['b.png', 'member']
		]);
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/attachment-links.test.ts`
Expected: FAIL（`./attachment-links` が存在しない）

- [ ] **Step 2: 紐付けを実装する**

`apps/web/src/lib/server/services/attachment-links.ts`:

```ts
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AppContext } from '../context';
import { attachment } from '../db/schema';

const ATTACHMENT_REF =
	/\/projects\/[A-Z][A-Z0-9]{1,9}\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

/** 本文中の添付 URL から添付 ID を重複なく取り出す */
export function referencedAttachmentIds(body: string): string[] {
	return [...new Set(Array.from(body.matchAll(ATTACHMENT_REF), (m) => m[1]))];
}

/**
 * 本文で参照している添付のうち、同じプロジェクトの本人の仮置きだけを課題（とコメント）に紐付ける。
 * 他人の添付や紐付き済みの添付は変更しない。
 */
export async function linkAttachments(
	ctx: AppContext,
	target: { projectId: string; issueId: string; commentId?: string },
	body: string
): Promise<void> {
	const ids = referencedAttachmentIds(body);
	if (ids.length === 0) return;
	await ctx.db
		.update(attachment)
		.set({ issueId: target.issueId, commentId: target.commentId ?? null })
		.where(
			and(
				inArray(attachment.id, ids),
				eq(attachment.projectId, target.projectId),
				isNull(attachment.issueId),
				eq(attachment.uploaderId, ctx.actor.id)
			)
		);
}
```

- [ ] **Step 3: issues.ts から呼ぶ**

`apps/web/src/lib/server/services/issues.ts` の import に `import { linkAttachments } from './attachment-links';` を追加する。

`createIssue` の `forgetProject(ctx, key);` の直前に追加:

```ts
	await linkAttachments(ctx, { projectId: p.id, issueId: id }, data.description);
```

`updateIssue` の末尾を次のように変える:

```ts
	if (Object.keys(patch).length === 0) return;
	await ctx.db.update(issue).set(patch).where(eq(issue.id, cur.id));
	if (patch.description !== undefined) {
		await linkAttachments(ctx, { projectId: p.id, issueId: cur.id }, patch.description);
	}
}
```

- [ ] **Step 4: comments.ts から呼ぶ**

`apps/web/src/lib/server/services/comments.ts` の import に `import { linkAttachments } from './attachment-links';` を追加する。

`addComment` の insert 部分を次に置き換える:

```ts
	const id = uuidv7();
	await ctx.db.insert(comment).values({ id, issueId: issue.id, authorId: ctx.actor.id, body });
	await linkAttachments(ctx, { projectId: project.id, issueId: issue.id, commentId: id }, body);
```

`findOwnedComment` の `return c;` を `return { ...c, projectId: project.id };` に変える。

`editComment` の update の後に追加:

```ts
	await linkAttachments(ctx, { projectId: c.projectId, issueId: c.issueId, commentId: c.id }, body);
```

- [ ] **Step 5: 一覧を実装する**

`apps/web/src/lib/server/services/attachments.ts`:
- `drizzle-orm` の import に `asc` を追加する。
- `../db/schema` の import に `user` を追加する。
- `import { getIssue } from './issues';` を追加する。

末尾に追加:

```ts
/** 課題に紐付いた添付（説明・コメントの両方）を古い順に返す */
export async function listAttachments(ctx: AppContext, key: string, number: number) {
	const { issue } = await getIssue(ctx, key, number);
	return ctx.db
		.select({
			id: attachment.id,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			uploaderId: attachment.uploaderId,
			uploaderName: user.name,
			createdAt: attachment.createdAt
		})
		.from(attachment)
		.innerJoin(user, eq(user.id, attachment.uploaderId))
		.where(eq(attachment.issueId, issue.id))
		.orderBy(asc(attachment.createdAt), asc(attachment.id));
}
```

（`attachments.ts` → `issues.ts` → `attachment-links.ts` の向きにだけ依存させ、循環させない。）

- [ ] **Step 6: テストを通す**

Run: `pnpm test:unit --run src/lib/server/services`
Expected: 新しいテストを含めすべて PASS（既存の issues/comments のテストも通ること）

- [ ] **Step 7: コミットする**

Run: `pnpm check && pnpm lint`
Expected: 成功

```bash
git add apps/web/src/lib/server/services
git commit -m "feat(web): link uploaded attachments to issues and comments"
```

---

### Task 3: 取得・削除・配信ヘッダ・課題削除時の後始末

**Files:**
- Modify: `apps/web/src/lib/server/services/attachments.ts`
- Modify: `apps/web/src/lib/server/services/attachments.test.ts`
- Modify: `apps/web/src/lib/server/services/issues.ts`（`deleteIssue`）

**Interfaces:**
- Consumes: Task 1・2 の各関数
- Produces:
  - `openAttachment(ctx, key: string, id: string): Promise<{ row: typeof attachment.$inferSelect; body: ReadableStream }>`
  - `deleteAttachment(ctx, key: string, id: string): Promise<void>`
  - `downloadHeaders(row: { filename: string; contentType: string }): Headers`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/server/services/attachments.test.ts`:
- import の `./attachments` に `deleteAttachment, downloadHeaders, openAttachment` を追加する。
- `../db/schema` の import を `import { attachment, project } from '../db/schema';` にする。
- `import { createIssue, deleteIssue } from './issues';` を追加する。

末尾に追加:

```ts
describe('attachments: open / delete', () => {
	let db: DB;
	let store: ReturnType<typeof createMemoryStore>;
	let base: ReturnType<typeof createTestBase>;
	let pending: Promise<unknown>[];
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const settle = () => Promise.all(pending.splice(0));

	beforeEach(async () => {
		db = await createTestDb();
		store = createMemoryStore();
		pending = [];
		base = createTestBase(db, { bucket: store, waitUntil: (p) => void pending.push(p) });
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'BETA', members: [member, outsider] });
	});

	it('参加者は中身を取得できる', async () => {
		const up = await uploadAttachment(as(guest), 'ACME', file('a.txt', 5, 'text/plain'));
		const { row, body } = await openAttachment(as(member), 'ACME', up.id);
		expect(row.filename).toBe('a.txt');
		expect((await new Response(body).arrayBuffer()).byteLength).toBe(5);
	});

	it('未参加・別プロジェクトのキー・R2 に実体がない場合は not_found', async () => {
		const up = await uploadAttachment(as(guest), 'ACME', file());
		await expect(openAttachment(as(outsider), 'ACME', up.id)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(openAttachment(as(member), 'BETA', up.id)).rejects.toMatchObject({
			code: 'not_found'
		});
		store.objects.clear();
		await expect(openAttachment(as(member), 'ACME', up.id)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('削除できるのは本人と admin。member でも他人の添付は forbidden', async () => {
		const a = await uploadAttachment(as(guest), 'ACME', file('a.png'));
		const b = await uploadAttachment(as(guest), 'ACME', file('b.png'));
		await expect(deleteAttachment(as(member), 'ACME', a.id)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await deleteAttachment(as(guest), 'ACME', a.id);
		await deleteAttachment(as(admin), 'ACME', b.id);
		await settle();
		expect(await db.select().from(attachment)).toHaveLength(0);
		expect(store.objects.size).toBe(0);
	});

	it('アーカイブ済みプロジェクトでは削除できない', async () => {
		const a = await uploadAttachment(as(guest), 'ACME', file());
		await db.update(project).set({ archivedAt: new Date() }).where(eq(project.key, 'ACME'));
		await expect(deleteAttachment(as(guest), 'ACME', a.id)).rejects.toMatchObject({
			code: 'conflict'
		});
	});

	it('課題を削除すると添付の行と R2 の実体も消える', async () => {
		const a = await uploadAttachment(as(member), 'ACME', file('a.png'));
		await createIssue(as(member), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await settle();
		await deleteIssue(as(member), 'ACME', 1);
		await settle();
		expect(await db.select().from(attachment)).toHaveLength(0);
		expect(store.objects.size).toBe(0);
	});
});

describe('downloadHeaders', () => {
	it('安全な画像は inline、それ以外は octet-stream の attachment', () => {
		const png = downloadHeaders({ filename: 'a.png', contentType: 'image/png' });
		expect(png.get('content-type')).toBe('image/png');
		expect(png.get('content-disposition')).toBe("inline; filename*=UTF-8''a.png");
		for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf']) {
			const h = downloadHeaders({ filename: 'x', contentType });
			expect(h.get('content-type')).toBe('application/octet-stream');
			expect(h.get('content-disposition')).toMatch(/^attachment; /);
		}
	});

	it('日本語と記号を含むファイル名を RFC 5987 で符号化し、共通ヘッダを付ける', () => {
		const h = downloadHeaders({ filename: "仕様書 (最終)'*.pdf", contentType: 'application/pdf' });
		expect(h.get('content-disposition')).toBe(
			"attachment; filename*=UTF-8''%E4%BB%95%E6%A7%98%E6%9B%B8%20%28%E6%9C%80%E7%B5%82%29%27%2A.pdf"
		);
		expect(h.get('x-content-type-options')).toBe('nosniff');
		expect(h.get('cache-control')).toBe('private, max-age=3600');
	});
});
```

Run: `pnpm test:unit --run src/lib/server/services/attachments.test.ts`
Expected: FAIL（`openAttachment` などが存在しない）

- [ ] **Step 2: 取得・削除・ヘッダを実装する**

`apps/web/src/lib/server/services/attachments.ts` の末尾に追加:

```ts
async function findAttachment(ctx: AppContext, key: string, id: string) {
	const p = await requireProject(ctx, key);
	const [row] = await ctx.db
		.select()
		.from(attachment)
		.where(and(eq(attachment.id, id), eq(attachment.projectId, p.id)));
	if (!row) throw new AppError('not_found', '添付ファイルが見つかりません');
	return { project: p, row };
}

export async function openAttachment(ctx: AppContext, key: string, id: string) {
	const { row } = await findAttachment(ctx, key, id);
	const obj = await ctx.bucket.get(row.r2Key);
	if (!obj) throw new AppError('not_found', '添付ファイルが見つかりません');
	return { row, body: obj.body };
}

export async function deleteAttachment(ctx: AppContext, key: string, id: string): Promise<void> {
	const { project: p, row } = await findAttachment(ctx, key, id);
	assertWritable(p);
	authorize(ctx.actor, 'attachment:delete', { uploaderId: row.uploaderId });
	await ctx.db.delete(attachment).where(eq(attachment.id, row.id));
	ctx.waitUntil(
		ctx.bucket.delete(row.r2Key).catch((e) => console.error('attachment delete failed', e))
	);
}

/** RFC 5987 の filename* 用。encodeURIComponent が残す ' ( ) * も符号化する */
function encodeFilename(name: string): string {
	return encodeURIComponent(name).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

/** 安全な画像だけインライン表示し、それ以外は種類を伏せて必ずダウンロードさせる */
export function downloadHeaders(row: { filename: string; contentType: string }): Headers {
	const image = isSafeImage(row.contentType);
	return new Headers({
		'Content-Type': image ? row.contentType : 'application/octet-stream',
		'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeFilename(row.filename)}`,
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': 'private, max-age=3600'
	});
}
```

- [ ] **Step 3: 課題削除で R2 を消す**

`apps/web/src/lib/server/services/issues.ts`:
- `../db/schema` の import に `attachment` を追加する。
- `deleteIssue` を次に置き換える。

```ts
export async function deleteIssue(ctx: AppContext, key: string, number: number): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	authorize(ctx.actor, 'issue:delete');
	const files = await ctx.db
		.select({ r2Key: attachment.r2Key })
		.from(attachment)
		.where(eq(attachment.issueId, cur.id));
	// 添付の行は課題の削除で連鎖削除される
	await ctx.db.delete(issue).where(eq(issue.id, cur.id));
	if (files.length > 0) {
		ctx.waitUntil(
			ctx.bucket
				.delete(files.map((f) => f.r2Key))
				.catch((e) => console.error('attachment delete failed', e))
		);
	}
}
```

- [ ] **Step 4: テストを通す**

Run: `pnpm test:unit --run`
Expected: すべて PASS

- [ ] **Step 5: コミットする**

Run: `pnpm check && pnpm lint`
Expected: 成功

```bash
git add apps/web/src/lib/server/services
git commit -m "feat(web): serve and delete attachments; remove R2 objects with their issue"
```

---

### Task 4: HTTP エンドポイントと remote functions

**Files:**
- Create: `apps/web/src/routes/projects/[key]/attachments/+server.ts`
- Create: `apps/web/src/routes/projects/[key]/attachments/[id]/+server.ts`
- Modify: `apps/web/src/routes/projects/[key]/issues/[number=int]/issue.remote.ts`
- Modify: `apps/web/e2e/main-flow.spec.ts`

**Interfaces:**
- Consumes: `uploadAttachment`, `openAttachment`, `downloadHeaders`, `listAttachments`, `deleteAttachment`, `attachmentUrl`, `isSafeImage`, `MAX_ATTACHMENT_BYTES`, `TOO_LARGE_MESSAGE`
- Produces:
  - `POST /projects/[key]/attachments`（multipart `file`）→ 201 `UploadResult` の JSON。エラー時は `{ message }` の JSON（`Accept: application/json` のとき）。
  - `GET /projects/[key]/attachments/[id]` → 本体と `downloadHeaders`。
  - remote: `getAttachments({ key, number })` は `{ id, filename, contentType, size, uploaderId, uploaderName, createdAt, url, isImage, canDelete }[]` を返す。`removeAttachment({ key, number, attachmentId })`。

- [ ] **Step 1: E2E に API の確認を追加する（失敗させる）**

`apps/web/e2e/main-flow.spec.ts` のステップ 5 の `await expect(page.getByRole('main').getByText('ACME-1')).toBeVisible();` の直後（`await logout(page);` の前）に追加:

```ts
	// 5b. 添付 API: アップロード → 配信ヘッダ（HTML は必ずダウンロード）→ 存在しない ID は 404
	const up = await page.request.post('/projects/ACME/attachments', {
		headers: { Origin: 'http://localhost:4173', Accept: 'application/json' },
		multipart: {
			file: {
				name: '仕様書.html',
				mimeType: 'text/html',
				buffer: Buffer.from('<script>alert(1)</script>')
			}
		}
	});
	expect(up.status()).toBe(201);
	const uploaded = await up.json();
	expect(uploaded).toMatchObject({ filename: '仕様書.html', isImage: false });
	const dl = await page.request.get(uploaded.url);
	expect(dl.status()).toBe(200);
	expect(dl.headers()['content-type']).toBe('application/octet-stream');
	expect(dl.headers()['content-disposition']).toBe(
		`attachment; filename*=UTF-8''${encodeURIComponent('仕様書.html')}`
	);
	expect(dl.headers()['x-content-type-options']).toBe('nosniff');
	expect(await dl.text()).toBe('<script>alert(1)</script>');
	const missing = await page.request.get(
		'/projects/ACME/attachments/00000000-0000-7000-8000-000000000000'
	);
	expect(missing.status()).toBe(404);
```

Run: `pnpm test:e2e`
Expected: FAIL（`/projects/ACME/attachments` が 404 または 405）

- [ ] **Step 2: アップロードのエンドポイントを書く**

`apps/web/src/routes/projects/[key]/attachments/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { MAX_ATTACHMENT_BYTES, TOO_LARGE_MESSAGE } from '$lib/attachment-rules';
import { appContext } from '$lib/server/context';
import { AppError } from '$lib/server/errors';
import { runCommand } from '$lib/server/remote-helpers';
import { uploadAttachment } from '$lib/server/services/attachments';
import type { RequestHandler } from './$types';

// multipart の境界やヘッダの分の余裕
const MULTIPART_OVERHEAD = 64 * 1024;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const ctx = appContext(locals);
	// runCommand: 権限・存在エラーは 404、それ以外はメッセージ付きの HTTP エラー
	return runCommand(async () => {
		const length = Number(request.headers.get('content-length') ?? 0);
		if (length > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD) {
			throw new AppError('validation', TOO_LARGE_MESSAGE);
		}
		const file = (await request.formData()).get('file');
		if (!(file instanceof File)) throw new AppError('validation', 'ファイルを選択してください');
		return json(await uploadAttachment(ctx, params.key, file), { status: 201 });
	});
};
```

- [ ] **Step 3: 配信のエンドポイントを書く**

`apps/web/src/routes/projects/[key]/attachments/[id]/+server.ts`:

```ts
import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { downloadHeaders, openAttachment } from '$lib/server/services/attachments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const { row, body } = await openAttachment(ctx, params.key, params.id);
		return new Response(body, { headers: downloadHeaders(row) });
	});
};
```

- [ ] **Step 4: remote functions を追加する**

`apps/web/src/routes/projects/[key]/issues/[number=int]/issue.remote.ts`:
- import に次を追加する。
  - `import { attachmentUrl, isSafeImage } from '$lib/attachment-rules';`
  - `import { deleteAttachment, listAttachments } from '$lib/server/services/attachments';`
- `getComments` の後に追加する。

```ts
export const getAttachments = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const [{ project }, rows] = await Promise.all([
			getIssue(ctx, key, number),
			listAttachments(ctx, key, number)
		]);
		return rows.map((a) => ({
			...a,
			url: attachmentUrl(project.key, a.id),
			isImage: isSafeImage(a.contentType),
			canDelete:
				!project.archivedAt && can(ctx.actor, 'attachment:delete', { uploaderId: a.uploaderId })
		}));
	});
});
```

ファイル末尾に追加:

```ts
export const removeAttachment = command(
	v.object({ ...IssueRefFields, attachmentId: v.string() }),
	({ key, number, attachmentId }) =>
		runCommand(async () => {
			await deleteAttachment(remoteContext(), key, attachmentId);
			void getAttachments({ key, number }).refresh();
		})
);
```

`saveIssue` / `postComment` / `updateComment` のそれぞれで、既存の `void ....refresh();` の次の行に `void getAttachments({ key, number }).refresh();` を追加する。本文の保存で添付の紐付けが変わるため。

- [ ] **Step 5: E2E を通す**

Run: `pnpm check && pnpm test:e2e`
Expected: PASS（wrangler dev は `wrangler.jsonc` の `r2_buckets` からローカルの R2 を自動で用意する）

- [ ] **Step 6: コミットする**

Run: `pnpm lint`
Expected: 成功

```bash
git add apps/web/src/routes apps/web/e2e/main-flow.spec.ts
git commit -m "feat(web): attachment upload/download endpoints and issue remote functions"
```

---

### Task 5: エディタの添付 UI と課題詳細の添付一覧

**Files:**
- Modify: `apps/web/src/lib/attachment-rules.ts`（`markdownFor`, `formatBytes`）
- Create: `apps/web/src/lib/attachment-rules.test.ts`
- Create: `apps/web/src/lib/attachment-upload.ts`
- Create: `apps/web/src/lib/components/AttachButton.svelte`
- Modify: `apps/web/src/lib/components/MarkdownEditor.svelte`
- Modify: `apps/web/src/routes/projects/[key]/issues/new/+page.svelte`
- Modify: `apps/web/src/routes/projects/[key]/issues/[number=int]/+page.svelte`
- Modify: `apps/web/e2e/main-flow.spec.ts`

**Interfaces:**
- Consumes: Task 4 の `POST /projects/[key]/attachments`, `getAttachments`, `removeAttachment`
- Produces:
  - `attachment-rules.ts`: `markdownFor(r: { filename: string; url: string; isImage: boolean }): string`, `formatBytes(n: number): string`
  - `attachment-upload.ts`: `uploadFile(projectKey, file): Promise<UploadResult>`, `insertUploads(el: HTMLTextAreaElement, projectKey: string, files: Iterable<File>): Promise<void>`, `uploadable(projectKey: string): Attachment<HTMLTextAreaElement>`
  - `<AttachButton projectKey target={() => textarea} />`（中の `<input type="file">` は `data-testid="attach-input"`）
  - `<MarkdownEditor projectKey="..." />`（`projectKey` を渡したときだけ添付が有効になる）

- [ ] **Step 1: 純粋関数の失敗するテストを書く**

`apps/web/src/lib/attachment-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBytes, markdownFor } from './attachment-rules';

describe('markdownFor', () => {
	const url = '/projects/ACME/attachments/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

	it('画像は ![]()、それ以外は []()', () => {
		expect(markdownFor({ filename: 'a.png', url, isImage: true })).toBe(`![a.png](${url})`);
		expect(markdownFor({ filename: 'a.pdf', url, isImage: false })).toBe(`[a.pdf](${url})`);
	});

	it('ファイル名の [ ] \\ をエスケープしてリンクを壊さない', () => {
		expect(markdownFor({ filename: '仕様書 (最終) [v2]\\.pdf', url, isImage: false })).toBe(
			`[仕様書 (最終) \\[v2\\]\\\\.pdf](${url})`
		);
	});
});

describe('formatBytes', () => {
	it('B / KB / MB で表示する', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
	});
});
```

Run: `pnpm test:unit --run src/lib/attachment-rules.test.ts`
Expected: FAIL（`markdownFor` が存在しない）

- [ ] **Step 2: 純粋関数を実装する**

`apps/web/src/lib/attachment-rules.ts` の末尾に追加:

```ts
/** 本文に挿入する Markdown。ファイル名の [ ] \ はエスケープする */
export function markdownFor(r: { filename: string; url: string; isImage: boolean }): string {
	const label = r.filename.replace(/[\\[\]]/g, (c) => `\\${c}`);
	return `${r.isImage ? '!' : ''}[${label}](${r.url})`;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
```

Run: `pnpm test:unit --run src/lib/attachment-rules.test.ts`
Expected: PASS

- [ ] **Step 3: ブラウザ側のアップロード処理を書く**

`apps/web/src/lib/attachment-upload.ts`:

```ts
import type { Attachment } from 'svelte/attachments';
import { MAX_ATTACHMENT_BYTES, TOO_LARGE_MESSAGE, markdownFor } from './attachment-rules';
import { toast } from './toast.svelte';

export interface UploadResult {
	id: string;
	url: string;
	filename: string;
	isImage: boolean;
}

export async function uploadFile(projectKey: string, file: File): Promise<UploadResult> {
	if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(TOO_LARGE_MESSAGE);
	const body = new FormData();
	body.append('file', file);
	const res = await fetch(`/projects/${projectKey}/attachments`, {
		method: 'POST',
		body,
		headers: { accept: 'application/json' }
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(data?.message ?? 'アップロードに失敗しました');
	}
	return res.json();
}

/** value を書き換えたことを bind:value・autosize・remote form に知らせる */
const notify = (el: HTMLTextAreaElement) => el.dispatchEvent(new Event('input', { bubbles: true }));

/** カーソル位置にプレースホルダを入れてアップロードし、終わったらリンクに置き換える（失敗時は消す） */
async function insertUpload(el: HTMLTextAreaElement, projectKey: string, file: File) {
	const placeholder = `![アップロード中: ${file.name.replace(/[[\]]/g, '')}]()`;
	el.setRangeText(placeholder, el.selectionStart, el.selectionEnd, 'end');
	notify(el);
	let replacement = '';
	try {
		replacement = markdownFor(await uploadFile(projectKey, file));
	} catch (e) {
		toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました');
	}
	const i = el.value.indexOf(placeholder);
	if (i === -1) return; // アップロード中にユーザーがプレースホルダを消した
	el.setRangeText(replacement, i, i + placeholder.length, 'preserve');
	notify(el);
}

/** 1 件ずつ順に送る（同名ファイルのプレースホルダが衝突しないように） */
export async function insertUploads(el: HTMLTextAreaElement, projectKey: string, files: Iterable<File>) {
	for (const f of files) await insertUpload(el, projectKey, f);
}

/** textarea への貼り付け・ドロップでファイルを添付する。ファイルを含まない操作には何もしない */
export function uploadable(projectKey: string): Attachment<HTMLTextAreaElement> {
	return (el) => {
		const onPaste = (e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []);
			if (files.length === 0) return;
			e.preventDefault();
			void insertUploads(el, projectKey, files);
		};
		const onDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
		};
		const onDrop = (e: DragEvent) => {
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length === 0) return;
			e.preventDefault();
			el.focus();
			void insertUploads(el, projectKey, files);
		};
		el.addEventListener('paste', onPaste);
		el.addEventListener('dragover', onDragOver);
		el.addEventListener('drop', onDrop);
		return () => {
			el.removeEventListener('paste', onPaste);
			el.removeEventListener('dragover', onDragOver);
			el.removeEventListener('drop', onDrop);
		};
	};
}
```

- [ ] **Step 4: 添付ボタンを書く**

`apps/web/src/lib/components/AttachButton.svelte`:

```svelte
<script lang="ts">
	import { Paperclip } from '@lucide/svelte';
	import { insertUploads } from '$lib/attachment-upload';

	let {
		projectKey,
		target
	}: { projectKey: string; target: () => HTMLTextAreaElement | null | undefined } = $props();
	let input = $state<HTMLInputElement>();

	async function onchange() {
		const el = target();
		const files = Array.from(input!.files ?? []);
		input!.value = ''; // 同じファイルを続けて選べるように
		if (el && files.length > 0) await insertUploads(el, projectKey, files);
	}
</script>

<button
	type="button"
	class="icon-btn"
	aria-label="ファイルを添付"
	title="ファイルを添付"
	onclick={() => input!.click()}
>
	<Paperclip />
</button>
<!-- name を付けないのでフォーム送信には含まれない -->
<input bind:this={input} type="file" multiple hidden {onchange} data-testid="attach-input" />
```

- [ ] **Step 5: MarkdownEditor に組み込む**

`apps/web/src/lib/components/MarkdownEditor.svelte`:
- `<script>` の import に次を追加する。
  - `import { uploadable } from '$lib/attachment-upload';`
  - `import AttachButton from './AttachButton.svelte';`
- props を次に置き換える。

```ts
	let {
		value = $bindable(''),
		projectKey,
		...rest
	}: HTMLTextareaAttributes & { value?: string; projectKey?: string } = $props();
```

テンプレートの textarea を次に置き換える:

```svelte
	<textarea
		bind:this={textarea}
		bind:value
		{...rest}
		{@attach projectKey && uploadable(projectKey)}
	></textarea>
```

ツールバーの `{#each tools ...}{/each}` の後に追加:

```svelte
		{#if projectKey}
			<AttachButton {projectKey} target={() => textarea} />
		{/if}
```

`.hint` の文言を、`projectKey` があるときは `Markdown が使えます・ファイルは貼り付けかドロップでも添付できます` にする:

```svelte
		<span class="hint"
			>Markdown が使えます{projectKey ? '・ファイルは貼り付けかドロップでも添付できます' : ''}</span
		>
```

- [ ] **Step 6: 新規起票ページで有効にする**

`apps/web/src/routes/projects/[key]/issues/new/+page.svelte` の MarkdownEditor に `projectKey={data.project.key}` を追加する:

```svelte
		<MarkdownEditor
			id="issue-description"
			name="description"
			rows={10}
			placeholder="課題の詳細"
			projectKey={data.project.key}
		/>
```

- [ ] **Step 7: 課題詳細ページに組み込む**

`apps/web/src/routes/projects/[key]/issues/[number=int]/+page.svelte`:

(a) import を追加する。
- `@lucide/svelte` の import に `Paperclip` を加える。
- 次の 3 行を追加する。
  - `import { formatBytes } from '$lib/attachment-rules';`
  - `import { uploadable } from '$lib/attachment-upload';`
  - `import AttachButton from '$lib/components/AttachButton.svelte';`
- `./issue.remote` の import に `getAttachments, removeAttachment` を加える。

(b) `const comments = $derived(await commentsQuery);` の後に追加:

```ts
	const attachmentsQuery = $derived(getAttachments(ref));
	const attachments = $derived(await attachmentsQuery);
	let commentInput = $state<HTMLTextAreaElement>();
	let descriptionInput = $state<HTMLTextAreaElement>();

	async function deleteAttachment(attachmentId: string) {
		try {
			await removeAttachment({ ...ref, attachmentId });
		} catch {
			failed();
		}
	}
```

（`failed` は既存のアロー関数で、宣言はこの後にある。`deleteAttachment` が呼ばれるのは描画後なので問題ない。）

`attachmentsQuery` の行は既存の `detailQuery` / `commentsQuery` の `$derived` 2 行のすぐ後に置き、3 つの取得が同時に始まるようにする。`await` の行はその後に置く。

(c) 編集中の本文 textarea（`id="issue-description"`）に `bind:this={descriptionInput}` と `{@attach uploadable(ref.key)}` を追加し、その下の `<p class="hint">` を次に置き換える:

```svelte
					<div class="flex items-center gap-2">
						<p class="hint" style="flex: 1">
							Markdown が使えます。ファイルは貼り付け・ドロップでも添付できます。右の「保存」で反映されます。
						</p>
						<AttachButton projectKey={ref.key} target={() => descriptionInput} />
					</div>
```

(d) 本文カード（`{:else}` 側の `<div class="card body">…</div>`）の `{/if}` の直後、コメントの `<section class="grid gap-4">` の前に追加:

```svelte
		{#if attachments.length > 0}
			<section class="card attachments" aria-label="添付ファイル">
				<h2 class="card-title">
					<Paperclip class="size-4" /> 添付ファイル
					<span class="font-medium text-muted-foreground">{attachments.length}</span>
				</h2>
				<ul>
					{#each attachments as a (a.id)}
						<li>
							<a
								href={a.url}
								target={a.isImage ? '_blank' : undefined}
								rel="noopener"
								download={a.isImage ? undefined : a.filename}>{a.filename}</a
							>
							<span class="text-xs text-muted-foreground"
								>{formatBytes(a.size)} · {a.uploaderName} · {formatDateTime(a.createdAt)}</span
							>
							{#if a.canDelete}
								<ConfirmAction
									onconfirm={() => deleteAttachment(a.id)}
									title="添付ファイルを削除しますか？"
									description={`「${a.filename}」を削除します。本文やコメントのリンクは表示できなくなります。この操作は元に戻せません。`}
									confirmLabel="削除する"
									triggerClass="icon-btn danger-hover ml-auto"
									triggerLabel={`${a.filename} を削除`}
								>
									{#snippet trigger()}<Trash2 />{/snippet}
								</ConfirmAction>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
```

`<style>` に追加:

```css
	.attachments ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.attachments li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		min-width: 0;
	}
	.attachments li a {
		overflow-wrap: anywhere;
	}
```

(e) 新規コメントの textarea（`id="new-comment"`）に `bind:this={commentInput}` と `{@attach uploadable(ref.key)}` を追加する。その下の `<div class="flex justify-end">` を次に置き換える:

```svelte
					<div class="flex items-center justify-end gap-2">
						<AttachButton projectKey={ref.key} target={() => commentInput} />
						<button type="submit" class="btn btn-primary">コメントする</button>
					</div>
```

(f) コメント編集の textarea に `{@attach uploadable(ref.key)}` を追加する（貼り付け・ドロップのみ対応）。

- [ ] **Step 8: E2E に UI の確認を追加する**

`apps/web/e2e/main-flow.spec.ts` の import 行の後に追加:

```ts
// 1x1 の透明 PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);
```

ステップ 5 の `await page.getByLabel('カテゴリー').selectOption({ label: 'フロントエンド' });` の後（「起票する」の前）に追加:

```ts
	await page
		.getByTestId('attach-input')
		.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
	await expect(page.getByLabel('本文')).toHaveValue(
		/!\[screen\.png\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)/
	);
```

同じステップの `await expect(page.getByRole('main').getByText('ACME-1')).toBeVisible();` の後に追加:

```ts
	const shot = page.locator('.markdown img[alt="screen.png"]');
	await expect(shot).toBeVisible();
	expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	await expect(
		page.getByRole('region', { name: '添付ファイル' }).getByRole('link', { name: 'screen.png' })
	).toBeVisible();
```

ステップ 8（ゲストがコメント）を次に置き換える:

```ts
	// 8. ゲストがコメント（PDF を添付）。テキストの貼り付けは横取りしない
	await page.goto('/projects/ACME/issues/1');
	const commentBox = page.getByLabel('コメントを追加');
	const textPastePrevented = await commentBox.evaluate((el) => {
		const data = new DataTransfer();
		data.setData('text/plain', 'hello');
		const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		el.dispatchEvent(ev);
		return ev.defaultPrevented;
	});
	expect(textPastePrevented).toBe(false);
	await commentBox.fill('確認しました\n');
	await page
		.locator('form.new-comment')
		.getByTestId('attach-input')
		.setInputFiles({
			name: 'spec.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
		});
	await expect(commentBox).toHaveValue(/\[spec\.pdf\]\(\/projects\/ACME\/attachments\//);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();
	const attachmentList = page.getByRole('region', { name: '添付ファイル' });
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeVisible();

	// 8b. 自分の添付を削除できる
	await attachmentList.getByRole('button', { name: 'spec.pdf を削除' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: '削除する' }).click();
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeHidden();
```

- [ ] **Step 9: 全体を確認する**

Run: `pnpm check && pnpm lint && pnpm test:unit --run && pnpm test:e2e`
Expected: すべて成功

続けて手で確認する。`pnpm dev` を起動し、課題の新規起票とコメント欄で次の3つを試す。
- スクリーンショットを貼り付けると、プレースホルダがリンクに置き換わる。
- 30MB のファイルを選ぶと、トースト「ファイルは25MB以下にしてください」が出てプレースホルダが消える。
- ダーク/ライト両方のテーマで添付一覧が崩れない。

Svelte ファイルの変更後は、svelte MCP の `svelte-autofixer` で `AttachButton.svelte`・`MarkdownEditor.svelte`・課題詳細 `+page.svelte` を確認し、指摘をなくす。

- [ ] **Step 10: コミットする**

```bash
git add apps/web/src apps/web/e2e/main-flow.spec.ts
git commit -m "feat(web): attach files from the editor and list attachments on issues"
```

---

### Task 6: ドキュメントと公開

**Files:**
- Modify: `apps/docs/src/content/docs/guides/requirements.md`
- Modify: `apps/docs/src/content/docs/guides/deploy.md`
- Modify: `apps/docs/src/content/docs/guides/update.md`
- Modify: `apps/docs/src/content/docs/reference/permissions.md`
- Modify: `docs/superpowers/specs/2026-10-09-project-manager-design.md`（MVP の「含まない」から添付を外し、権限表に 2 行を追加）

**Interfaces:**
- Consumes: Task 1〜5 の完成した機能

- [ ] **Step 1: 必要なアカウントに R2 を追記する**

`requirements.md` のアカウント表の Turso の行の後に追加:

```markdown
| Cloudflare R2 | **必須** | 添付ファイルの保存 | 10GB まで無料。初回はダッシュボードの「R2」で利用を開始する |
```

- [ ] **Step 2: デプロイ手順にバケット作成を追記する**

`deploy.md` の手順 4 のコードブロック（`wrangler secret put BETTER_AUTH_URL` を含むもの）の直後に追加:

````markdown
添付ファイルを保存する R2 バケットを作ります（名前は `apps/web/wrangler.jsonc` の `bucket_name` と同じにします）。

```bash
pnpm exec wrangler r2 bucket create project-manager-attachments
```
````

- [ ] **Step 3: アップデート手順に注意を追記する**

`update.md` の末尾に追加:

````markdown
## 添付ファイル機能を含むバージョンへ更新する場合

デプロイの前に、R2 バケットを一度だけ作成してください。

```bash
pnpm exec wrangler r2 bucket create project-manager-attachments
```
````

- [ ] **Step 4: 権限表に追記する**

`reference/permissions.md` の表の「コメントの編集・削除」の行の後に追加:

```markdown
| 添付ファイルのアップロード | ○ | ○ | ○ |
| 添付ファイルの削除 | すべて | 自分のもの | 自分のもの |
```

表の下の箇条書きに追加:

```markdown
- 添付ファイルは 1 ファイル 25MB まで。PNG・JPEG・GIF・WebP の画像は本文に表示され、それ以外はダウンロードになります。
```

本体設計書 `docs/superpowers/specs/2026-10-09-project-manager-design.md` も更新する。
- 39 行目の「含まない（将来）」から「ファイル添付（R2）」を削除する。
- §3 の権限表の末尾に、上と同じ 2 行を追加する（列見出しの表記は本体設計書に合わせて `全て` を使う）。

- [ ] **Step 5: ドキュメントのビルドを確認してコミットする**

Run: `cd /Users/izukihirano/orca/projects/project-manager && pnpm --filter docs build`
Expected: 成功（filter 名が違う場合は `apps/docs/package.json` の `name` を使う）

```bash
git add apps/docs docs/superpowers/specs/2026-10-09-project-manager-design.md
git commit -m "docs: document attachments setup, update steps and permissions"
```

- [ ] **Step 6: push と PR**

```bash
git push -u origin feat/attachments
gh pr create --title "feat(web): file attachments (R2)" --body "<変更概要・本番手順（下記）を記載>"
```

- [ ] **Step 7: 本番反映（PR マージ後）**

CLAUDE.md の手順に従う。マイグレーションを伴うので、実行前にユーザーへ伝える。

1. R2 バケットを作る: `cd apps/web && pnpm exec wrangler r2 bucket create project-manager-attachments`（`CLOUDFLARE_ACCOUNT_ID` を環境変数で渡す）
2. マイグレーション（ユーザーに `!` で実行してもらう）:
   ```
   ! cd /Users/izukihirano/orca/projects/project-manager/apps/web && TURSO_DATABASE_URL=libsql://project-manager-izu12ki.aws-ap-northeast-1.turso.io TURSO_AUTH_TOKEN="$(turso db tokens create project-manager --expiration 1d)" pnpm db:migrate
   ```
3. 反映の確認: `turso db shell project-manager "SELECT name FROM pragma_table_info('attachment');"` で 10 列が返ること
4. `pnpm check && pnpm lint && pnpm test:unit --run && pnpm test:e2e` が通ったら `pnpm deploy`。バージョン ID と URL を報告する
