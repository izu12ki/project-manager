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
