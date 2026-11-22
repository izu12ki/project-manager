import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { invitation, invitationProject, projectMember, user } from '../db/schema';
import { sha256Hex } from '../tokens';
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
			createInvitation(ctxOf(base, member), {
				email: 'x@example.com',
				role: 'member',
				projectIds: [projectId]
			})
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('招待するとリンクを返し、メールを送り、DB にはハッシュだけ保存する', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'Guest@Example.com',
			role: 'guest',
			projectIds: [projectId]
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
			projectNames: ['Acme'],
			name: null
		});
	});

	it('メンバー・ゲストとも参加プロジェクトが必須', async () => {
		for (const role of ['guest', 'member']) {
			await expect(
				createInvitation(ctxOf(base, admin), { email: 'g@example.com', role, projectIds: [] })
			).rejects.toMatchObject({ code: 'validation' });
		}
	});

	it('管理者のロールなら参加プロジェクトなしで招待できる', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'a2@example.com',
			role: 'admin',
			projectIds: []
		});
		expect(base.sent[0].subject).toContain('Project Manager');
		await acceptInvitation(base, { token: tokenOf(url), name: 'A2', password: 'password-1234' });
		const [u] = await db.select().from(user).where(eq(user.email, 'a2@example.com'));
		expect(
			await db.select().from(projectMember).where(eq(projectMember.userId, u.id))
		).toHaveLength(0);
	});

	it('招待に名前を持たせると、招待を受ける画面に出る', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'n@example.com',
			role: 'member',
			projectIds: [projectId],
			name: ' 鈴木 花子 '
		});
		expect((await getInvitationByToken(db, tokenOf(url)))?.name).toBe('鈴木 花子');
	});

	it('名前なしで招待し直すと前の招待の名前を引き継ぎ、再発行でも残る', async () => {
		const ctx = ctxOf(base, admin);
		await createInvitation(ctx, {
			email: 'n@example.com',
			role: 'member',
			projectIds: [projectId],
			name: '鈴木 花子'
		});
		const { url } = await createInvitation(ctx, {
			email: 'n@example.com',
			role: 'member',
			projectIds: [projectId]
		});
		expect((await getInvitationByToken(db, tokenOf(url)))?.name).toBe('鈴木 花子');
		const [row] = await db.select().from(invitation);
		const { url: again } = await reissueInvitation(ctx, row.id);
		expect((await getInvitationByToken(db, tokenOf(again)))?.name).toBe('鈴木 花子');
	});

	it('名前が 51 文字なら validation', async () => {
		await expect(
			createInvitation(ctxOf(base, admin), {
				email: 'n@example.com',
				role: 'member',
				projectIds: [projectId],
				name: 'あ'.repeat(51)
			})
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('複数のプロジェクトに招待でき、受諾するとすべてに参加する', async () => {
		const { id: other } = await seedProject(db, { key: 'BETA', name: 'Beta' });
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId, other]
		});
		expect(base.sent[0].subject).toContain('「Acme」「Beta」');
		expect((await getInvitationByToken(db, tokenOf(url)))?.projectNames).toEqual(['Acme', 'Beta']);
		await acceptInvitation(base, { token: tokenOf(url), name: 'M', password: 'password-1234' });
		const [u] = await db.select().from(user).where(eq(user.email, 'm@example.com'));
		const joined = await db.select().from(projectMember).where(eq(projectMember.userId, u.id));
		expect(joined.map((m) => m.projectId).sort()).toEqual([projectId, other].sort());
	});

	it('同じメールに別のプロジェクトから招待し直すと、前の招待のプロジェクトを引き継ぐ', async () => {
		const { id: other } = await seedProject(db, { key: 'BETA', name: 'Beta' });
		const ctx = ctxOf(base, admin);
		const { url: first } = await createInvitation(ctx, {
			email: 'g@example.com',
			role: 'member',
			projectIds: [projectId]
		});
		const { url: second } = await createInvitation(ctx, {
			email: 'g@example.com',
			role: 'guest',
			projectIds: [other]
		});
		expect(await getInvitationByToken(db, tokenOf(first))).toBeNull();
		expect(await getInvitationByToken(db, tokenOf(second))).toMatchObject({
			role: 'guest',
			projectNames: ['Acme', 'Beta']
		});
		expect(base.sent[1].subject).toContain('「Acme」「Beta」');
		expect(await listPendingInvitations(ctx)).toHaveLength(1);
		await acceptInvitation(base, { token: tokenOf(second), name: 'G', password: 'password-1234' });
		const [u] = await db.select().from(user).where(eq(user.email, 'g@example.com'));
		const joined = await db.select().from(projectMember).where(eq(projectMember.userId, u.id));
		expect(joined.map((m) => m.projectId).sort()).toEqual([projectId, other].sort());
	});

	it('期限切れの招待のプロジェクトは引き継がない', async () => {
		const { id: other } = await seedProject(db, { key: 'BETA', name: 'Beta' });
		const ctx = ctxOf(base, admin);
		await createInvitation(ctx, { email: 'g@example.com', role: 'guest', projectIds: [projectId] });
		await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) });
		const { url } = await createInvitation(ctx, {
			email: 'g@example.com',
			role: 'guest',
			projectIds: [other]
		});
		expect((await getInvitationByToken(db, tokenOf(url)))?.projectNames).toEqual(['Beta']);
		expect(await listPendingInvitations(ctx)).toHaveLength(1);
	});

	it('登録済みのメールアドレスは conflict', async () => {
		await expect(
			createInvitation(ctxOf(base, admin), {
				email: admin.email,
				role: 'member',
				projectIds: [projectId]
			})
		).rejects.toMatchObject({ code: 'conflict' });
	});

	it('受諾するとユーザーを作り、プロジェクトに参加させ、リンクは再利用できない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'guest@example.com',
			role: 'guest',
			projectIds: [projectId]
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

	it('同じメール宛ての招待 2 件を同時に受諾したら、失敗した側の招待は未使用に戻る', async () => {
		// 2 件とも重複チェックを通り、後から実行された登録が user_email_uq で失敗する状況
		const tokens = ['token-a', 'token-b'];
		for (const [i, token] of tokens.entries()) {
			const id = `inv-${i}`;
			await db.insert(invitation).values({
				id,
				email: 'same@example.com',
				role: 'member',
				tokenHash: await sha256Hex(token),
				invitedBy: admin.id,
				expiresAt: new Date(Date.now() + 60_000)
			});
			await db.insert(invitationProject).values({ invitationId: id, projectId });
		}

		const results = await Promise.allSettled(
			tokens.map((token) => acceptInvitation(base, { token, name: 'S', password: 'password-1234' }))
		);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const failed = results.findIndex((r) => r.status === 'rejected');
		const reason = results[failed].status === 'rejected' && results[failed].reason;
		expect(reason).toMatchObject({ code: 'conflict' });
		expect(await db.select().from(user).where(eq(user.email, 'same@example.com'))).toHaveLength(1);
		const [left] = await db
			.select()
			.from(invitation)
			.where(eq(invitation.id, `inv-${failed}`));
		expect(left.acceptedAt).toBeNull();
	});

	it('アドミンとして招待でき、受諾したユーザーの role が admin になる', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'boss@example.com',
			role: 'admin',
			projectIds: [projectId]
		});
		await acceptInvitation(base, {
			token: tokenOf(url),
			name: '管理者2',
			password: 'password-1234'
		});
		const [u] = await db.select().from(user).where(eq(user.email, 'boss@example.com'));
		expect(u.role).toBe('admin');
	});

	it('期限切れのリンクは使えない', async () => {
		const { url } = await createInvitation(ctxOf(base, admin), {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId]
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
		const { url: oldUrl } = await createInvitation(ctx, {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId]
		});
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
		await createInvitation(ctx, {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId]
		});
		const [pending] = await listPendingInvitations(ctx);
		await revokeInvitation(ctx, pending.id);
		expect(await listPendingInvitations(ctx)).toHaveLength(0);
	});

	it('再発行後、古いトークンでは受諾できない', async () => {
		const ctx = ctxOf(base, admin);
		const { url: oldUrl } = await createInvitation(ctx, {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId]
		});
		const [pending] = await listPendingInvitations(ctx);
		await reissueInvitation(ctx, pending.id);

		await expect(
			acceptInvitation(base, { token: tokenOf(oldUrl), name: 'X', password: 'password-1234' })
		).rejects.toMatchObject({ code: 'not_found' });
		expect(await db.select().from(user)).toHaveLength(1);
	});

	it('取り消し後、そのトークンでは受諾できない', async () => {
		const ctx = ctxOf(base, admin);
		const { url } = await createInvitation(ctx, {
			email: 'm@example.com',
			role: 'member',
			projectIds: [projectId]
		});
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
			role: 'member',
			projectIds: [projectId]
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
		const { id: other } = await seedProject(db, { key: 'BETA', name: 'Beta' });
		await createInvitation(ctx, { email: 'g@example.com', role: 'guest', projectIds: [projectId] });
		await createInvitation(ctx, { email: 'm@example.com', role: 'member', projectIds: [other] });
		const list = await listPendingInvitations(ctx, { projectId });
		expect(list.map((i) => i.email)).toEqual(['g@example.com']);
		expect(list[0]).toMatchObject({ projects: [{ id: projectId, name: 'Acme' }], expired: false });
	});
});
