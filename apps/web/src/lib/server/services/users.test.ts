import { describe, expect, it } from 'vitest';
import { session } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedUser } from '../test-utils';
import { disableUser, enableUser, isDisabledEmail, listUsers } from './users';

describe('users', () => {
	it('無効化するとセッションが消え、ログイン拒否の判定が true になる', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin');
		const guest = await seedUser(db, 'guest');
		await db.insert(session).values({
			id: 's1',
			token: 't1',
			userId: guest.id,
			expiresAt: new Date(Date.now() + 60_000)
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
		await expect(disableUser(ctxOf(base, admin), admin.id)).rejects.toMatchObject({
			code: 'validation'
		});
		await expect(disableUser(ctxOf(base, member), admin.id)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(listUsers(ctxOf(base, member))).rejects.toMatchObject({ code: 'forbidden' });
		expect(await listUsers(ctxOf(base, admin))).toHaveLength(2);
	});

	it('無効化したユーザーを有効化できる（admin のみ・未知の ID は not_found）', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin');
		const member = await seedUser(db, 'member');
		await disableUser(ctxOf(base, admin), member.id);
		await expect(enableUser(ctxOf(base, member), member.id)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(enableUser(ctxOf(base, admin), 'nope')).rejects.toMatchObject({
			code: 'not_found'
		});
		await enableUser(ctxOf(base, admin), member.id);
		expect(await isDisabledEmail(db, member.email)).toBe(false);
	});
});
