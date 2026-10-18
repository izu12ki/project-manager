import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '$lib/attachment-rules';
import { createMemoryStore } from '../attachment-store';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { attachment, project } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	deleteAttachment,
	downloadHeaders,
	normalizeContentType,
	openAttachment,
	purgeStaleUploads,
	sanitizeFilename,
	uploadAttachment
} from './attachments';
import { createIssue, deleteIssue } from './issues';

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
	const ids = async () =>
		(await db.select({ id: attachment.id }).from(attachment)).map((r) => r.id);

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

	it('課題を削除しても、削除履歴から見られるよう添付の行と R2 の実体は残す', async () => {
		const a = await uploadAttachment(as(member), 'ACME', file('a.png'));
		await createIssue(as(member), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await settle();
		await deleteIssue(as(member), 'ACME', 1);
		await settle();
		expect(await db.select().from(attachment)).toHaveLength(1);
		expect(store.objects.size).toBe(1);
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
