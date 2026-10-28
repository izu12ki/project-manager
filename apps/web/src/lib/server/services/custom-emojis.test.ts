import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../attachment-store';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { commentReaction } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addComment, listComments, toggleReaction } from './comments';
import {
	addCustomEmoji,
	deleteCustomEmoji,
	listCustomEmojis,
	openCustomEmoji
} from './custom-emojis';
import { createIssue } from './issues';

const png = (size = 8) => new File([new Uint8Array(size)], 'e.png', { type: 'image/png' });

describe('custom emojis', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let store: ReturnType<typeof createMemoryStore>;
	let admin: Actor, member: Actor, other: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		store = createMemoryStore();
		base = createTestBase(db, { bucket: store });
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		other = await seedUser(db, 'member', 'other');
		guest = await seedUser(db, 'guest');
	});

	it('名前は : を外して小文字にそろえ、名前順に並ぶ', async () => {
		await addCustomEmoji(as(member), { name: ':Party:', file: png() });
		await addCustomEmoji(as(member), { name: '承認', file: png() });
		await addCustomEmoji(as(member), { name: 'ack', file: png() });
		const list = await listCustomEmojis(as(member));
		expect(list.map((e) => e.name)).toEqual(['ack', 'party', '承認']);
		expect(list[0].url).toMatch(/^\/emoji\/[0-9a-f-]{36}$/);
		const { contentType } = await openCustomEmoji(as(guest), list[0].id);
		expect(contentType).toBe('image/png');
	});

	it('同じ名前・使えない文字・画像以外・大きすぎる画像は登録できない', async () => {
		await addCustomEmoji(as(member), { name: 'party', file: png() });
		await expect(addCustomEmoji(as(other), { name: 'PARTY', file: png() })).rejects.toMatchObject({
			code: 'conflict'
		});
		await expect(addCustomEmoji(as(member), { name: 'a b', file: png() })).rejects.toMatchObject({
			code: 'validation'
		});
		await expect(
			addCustomEmoji(as(member), {
				name: 'svg',
				file: new File(['<svg/>'], 'e.svg', { type: 'image/svg+xml' })
			})
		).rejects.toMatchObject({ code: 'validation' });
		await expect(
			addCustomEmoji(as(member), { name: 'big', file: png(256 * 1024 + 1) })
		).rejects.toMatchObject({ code: 'validation' });
		expect(store.objects.size).toBe(1);
	});

	it('ゲストは登録できない', async () => {
		await expect(addCustomEmoji(as(guest), { name: 'x', file: png() })).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it('消せるのは登録した本人と管理者', async () => {
		await addCustomEmoji(as(member), { name: 'a', file: png() });
		await addCustomEmoji(as(member), { name: 'b', file: png() });
		const [a, b] = await listCustomEmojis(as(other));
		expect([a.canDelete, b.canDelete]).toEqual([false, false]);
		await expect(deleteCustomEmoji(as(other), a.id)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await deleteCustomEmoji(as(member), a.id);
		await deleteCustomEmoji(as(admin), b.id);
		await Promise.all(base.pending);
		expect(await listCustomEmojis(as(member))).toEqual([]);
		expect(store.objects.size).toBe(0);
	});

	describe('リアクション', () => {
		let commentId: string;
		beforeEach(async () => {
			await seedProject(db, { members: [member, guest] });
			await createIssue(as(member), 'ACME', { title: 'A' });
			await addComment(as(member), 'ACME', 1, { body: 'c' });
			commentId = (await listComments(as(member), 'ACME', 1))[0].id;
			await addCustomEmoji(as(member), { name: 'party', file: png() });
		});

		it('登録済みのカスタム絵文字でリアクションできる', async () => {
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: ':party:' });
			const [c] = await listComments(as(member), 'ACME', 1);
			expect(c.reactions).toEqual([{ emoji: ':party:', users: [{ id: guest.id, name: 'guest' }] }]);
		});

		it('未登録の名前ではリアクションできない', async () => {
			await expect(
				toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: ':nope:' })
			).rejects.toMatchObject({ code: 'validation' });
		});

		it('絵文字を消すとそのリアクションも消える', async () => {
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: ':party:' });
			await toggleReaction(as(guest), 'ACME', 1, commentId, { emoji: '👍' });
			const [e] = await listCustomEmojis(as(member));
			await deleteCustomEmoji(as(member), e.id);
			expect((await db.select().from(commentReaction)).map((r) => r.emoji)).toEqual(['👍']);
		});
	});
});
