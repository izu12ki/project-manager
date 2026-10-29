import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { session, user } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedUser } from '../test-utils';
import { changeUserRole, disableUser, enableUser, isDisabledEmail, listUsers } from './users';

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

	it('自分自身は有効化できない（無効化が反映される前のセッションで戻させない）', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin');
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));
		await expect(enableUser(ctxOf(base, admin), admin.id)).rejects.toMatchObject({
			code: 'validation',
			message: '自分自身は有効化できません'
		});
		expect(await isDisabledEmail(db, admin.email)).toBe(true);
	});

	it('有効な管理者が 0 人になる無効化は拒否する', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		// 操作者 A は admin だが DB 上は無効化済み（同時に無効化し合った場合と同じ状態）
		const a = await seedUser(db, 'admin', 'A');
		const b = await seedUser(db, 'admin', 'B');
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, a.id));

		await expect(disableUser(ctxOf(base, a), b.id)).rejects.toMatchObject({
			code: 'validation',
			message: '管理者が 1 人もいなくなるため無効化できません'
		});
		expect(await isDisabledEmail(db, b.email)).toBe(false);
		await expect(disableUser(ctxOf(base, a), 'nope')).rejects.toMatchObject({
			code: 'not_found'
		});

		// 他に有効な admin がいれば成功する
		await seedUser(db, 'admin', 'C');
		await disableUser(ctxOf(base, a), b.id);
		expect(await isDisabledEmail(db, b.email)).toBe(true);
	});

	describe('changeUserRole', () => {
		it('ロールを変更でき、その人のセッションが消える', async () => {
			const db = await createTestDb();
			const base = createTestBase(db);
			const admin = await seedUser(db, 'admin');
			const member = await seedUser(db, 'member');
			await db.insert(session).values({
				id: 's1',
				token: 't1',
				userId: member.id,
				expiresAt: new Date(Date.now() + 60_000)
			});

			await changeUserRole(ctxOf(base, admin), member.id, 'admin');

			const users = await listUsers(ctxOf(base, admin));
			expect(users.find((u) => u.id === member.id)?.role).toBe('admin');
			expect(await db.select().from(session)).toHaveLength(0);
		});

		it('自分自身のロールは変更できない', async () => {
			const db = await createTestDb();
			const base = createTestBase(db);
			const admin = await seedUser(db, 'admin');
			await expect(changeUserRole(ctxOf(base, admin), admin.id, 'member')).rejects.toMatchObject({
				code: 'validation',
				message: '自分自身のロールは変更できません'
			});
		});

		it('有効なアドミンが 0 人になる変更は拒否する', async () => {
			const db = await createTestDb();
			const base = createTestBase(db);
			// 操作者 A は admin だが DB 上は無効化済み（B も同様）
			const a = await seedUser(db, 'admin', 'A');
			const b = await seedUser(db, 'admin', 'B');
			const c = await seedUser(db, 'admin', 'C');
			await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, a.id));
			await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, b.id));

			await expect(changeUserRole(ctxOf(base, a), c.id, 'member')).rejects.toMatchObject({
				code: 'validation',
				message: '管理者が 1 人もいなくなるため変更できません'
			});

			// 他に有効な admin がいれば成功する
			const d = await seedUser(db, 'admin', 'D');
			await changeUserRole(ctxOf(base, a), c.id, 'member');
			const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, c.id));
			expect(row.role).toBe('member');
			expect(d.role).toBe('admin');
		});

		it('member は変更できない / 未知の ID は not_found / 不正なロールは validation', async () => {
			const db = await createTestDb();
			const base = createTestBase(db);
			const admin = await seedUser(db, 'admin');
			const member = await seedUser(db, 'member');
			await expect(changeUserRole(ctxOf(base, member), admin.id, 'member')).rejects.toMatchObject({
				code: 'forbidden'
			});
			await expect(changeUserRole(ctxOf(base, admin), 'nope', 'member')).rejects.toMatchObject({
				code: 'not_found'
			});
			await expect(changeUserRole(ctxOf(base, admin), member.id, 'owner')).rejects.toMatchObject({
				code: 'validation'
			});
		});
	});
});
