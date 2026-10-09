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
			email: 'Guest@Example.com',
			role: 'guest',
			projectId
		});
		expect(url).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/);
		expect(base.sent).toHaveLength(1);
		expect(base.sent[0].to).toBe('guest@example.com');
		expect(base.sent[0].text).toContain(url);
		const [row] = await db.select().from(invitation);
		expect(row.tokenHash).not.toBe(tokenOf(url));
		expect(await getInvitationByToken(db, tokenOf(url))).toEqual({
			email: 'guest@example.com',
			role: 'guest',
			projectName: 'Acme'
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
			email: 'guest@example.com',
			role: 'guest',
			projectId
		});
		const input = { token: tokenOf(url), name: '顧客', password: 'password-1234' };

		expect(await acceptInvitation(base, input)).toEqual({ email: 'guest@example.com' });

		const [u] = await db.select().from(user).where(eq(user.email, 'guest@example.com'));
		expect(u.role).toBe('guest');
		expect(
			await db.select().from(projectMember).where(eq(projectMember.userId, u.id))
		).toHaveLength(1);
		await expect(acceptInvitation(base, input)).rejects.toMatchObject({ code: 'not_found' });
		expect(await getInvitationByToken(db, tokenOf(url))).toBeNull();
	});

	it('期限切れのリンクは使えない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'm@example.com',
			role: 'member'
		});
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

	it('再発行後、古いトークンでは受諾できない', async () => {
		const ctx = ctxOf(base, admin);
		const { url: oldUrl } = await createInvitation(ctx, { email: 'm@example.com', role: 'member' });
		const [pending] = await listPendingInvitations(ctx);
		await reissueInvitation(ctx, pending.id);

		await expect(
			acceptInvitation(base, { token: tokenOf(oldUrl), name: 'X', password: 'password-1234' })
		).rejects.toMatchObject({ code: 'not_found' });
		expect(await db.select().from(user)).toHaveLength(1);
	});

	it('取り消し後、そのトークンでは受諾できない', async () => {
		const ctx = ctxOf(base, admin);
		const { url } = await createInvitation(ctx, { email: 'm@example.com', role: 'member' });
		const [pending] = await listPendingInvitations(ctx);
		await revokeInvitation(ctx, pending.id);

		await expect(
			acceptInvitation(base, { token: tokenOf(url), name: 'X', password: 'password-1234' })
		).rejects.toMatchObject({ code: 'not_found' });
		expect(await db.select().from(user)).toHaveLength(1);
	});

	it('受諾時にメールが既に登録されていたら conflict で、招待は使用済みにならない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'dup@example.com',
			role: 'member'
		});
		await db.insert(user).values({
			id: 'u-dup',
			name: 'Dup',
			email: 'dup@example.com',
			role: 'member',
			emailVerified: true
		});

		await expect(
			acceptInvitation(base, { token: tokenOf(url), name: 'X', password: 'password-1234' })
		).rejects.toMatchObject({ code: 'conflict' });
		const [inv] = await db.select().from(invitation);
		expect(inv.acceptedAt).toBeNull();
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
