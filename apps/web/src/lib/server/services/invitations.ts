import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { inList, insertChunks } from '../db/limits';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize, type Role } from '../authz';
import type { AppContext, BaseContext } from '../context';
import type { DB } from '../db';
import { invitation, invitationProject, project, projectMember, user } from '../db/schema';
import { AppError, isUniqueViolation } from '../errors';
import type { MailMessage } from '../mailer';
import { invitationMail } from '../mailer/templates';
import { randomToken, sha256Hex } from '../tokens';
import { EmailSchema, NameSchema, parse, PasswordSchema } from '../validation';
import { credentialUserInserts } from './credentials';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITE = '招待リンクが無効か、期限切れです。管理者に再発行を依頼してください';

const CreateInput = v.object({
	email: EmailSchema,
	role: v.picklist(['admin', 'member', 'guest', 'viewer'], 'ロールを選択してください'),
	projectIds: v.optional(v.array(v.string()), []),
	name: v.optional(v.union([v.literal(''), NameSchema]), '')
});

/** 招待ごとの参加プロジェクト（名前順） */
async function projectsOf(db: DB, invitationIds: string[]) {
	if (invitationIds.length === 0) return new Map<string, { id: string; name: string }[]>();
	const rows = await db
		.select({ invitationId: invitationProject.invitationId, id: project.id, name: project.name })
		.from(invitationProject)
		.innerJoin(project, eq(project.id, invitationProject.projectId))
		.where(inList(invitationProject.invitationId, invitationIds))
		.orderBy(asc(project.name));
	const map = new Map<string, { id: string; name: string }[]>();
	for (const r of rows) map.set(r.invitationId, [...(map.get(r.invitationId) ?? []), r]);
	return map;
}

export async function createInvitation(
	ctx: AppContext,
	input: unknown,
	opts: { sendMail?: boolean } = {}
): Promise<{ url: string; mail: MailMessage }> {
	authorize(ctx.actor, 'user:manage');
	const data = parse(CreateInput, input);
	const projectIds = [...new Set(data.projectIds.filter(Boolean))];
	if (data.role !== 'admin' && projectIds.length === 0) {
		throw new AppError('validation', '参加プロジェクトを選択してください', {
			projectIds: ['参加プロジェクトを選択してください']
		});
	}
	const projects =
		projectIds.length === 0
			? []
			: await ctx.db
					.select({ id: project.id, name: project.name })
					.from(project)
					.where(inList(project.id, projectIds))
					.orderBy(asc(project.name));
	if (projects.length !== projectIds.length) {
		throw new AppError('validation', 'プロジェクトが見つかりません', {
			projectIds: ['プロジェクトが見つかりません']
		});
	}
	const [existing] = await ctx.db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, data.email));
	if (existing)
		throw new AppError('conflict', 'このメールアドレスのユーザーは既に登録されています');

	// 同じメールの未承諾の招待は、新しいリンク 1 つにまとめる（古いリンクは使えなくなる）。
	// 期限内の招待の参加プロジェクトは引き継ぎ、別のプロジェクトから招待しても前に招待された
	// プロジェクトに入れるようにする。ロールは新しい招待のもの。名前も、指定がなければ引き継ぐ
	const pending = await ctx.db
		.select({ id: invitation.id, expiresAt: invitation.expiresAt, name: invitation.name })
		.from(invitation)
		.where(and(eq(invitation.email, data.email), isNull(invitation.acceptedAt)));
	const livePending = pending.filter((p) => p.expiresAt.getTime() >= Date.now());
	const live = livePending.map((p) => p.id);
	const name = data.name || livePending.find((p) => p.name)?.name || null;
	for (const p of [...(await projectsOf(ctx.db, live)).values()].flat()) {
		if (!projects.some((q) => q.id === p.id)) projects.push(p);
	}
	projects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	const token = randomToken();
	const id = uuidv7();
	await ctx.db.batch([
		ctx.db
			.delete(invitation)
			.where(and(eq(invitation.email, data.email), isNull(invitation.acceptedAt))),
		ctx.db.insert(invitation).values({
			id,
			email: data.email,
			role: data.role,
			name,
			tokenHash: await sha256Hex(token),
			invitedBy: ctx.actor.id,
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		}),
		...insertChunks(
			invitationProject,
			projects.map((p) => ({ invitationId: id, projectId: p.id }))
		).map((part) => ctx.db.insert(invitationProject).values(part))
	]);

	const url = `${ctx.baseUrl}/invite/${token}`;
	const mail: MailMessage = {
		to: data.email,
		...invitationMail({
			url,
			inviterName: ctx.actor.name,
			projectNames: projects.map((p) => p.name)
		})
	};
	// sendMail: false のときは送らずに返す（まとめて招待するときは呼び出し側が間隔を空けて送る）
	if (opts.sendMail ?? true) {
		ctx.waitUntil(ctx.mailer.send(mail).catch((e) => console.error('invitation mail failed', e)));
	}
	return { url, mail };
}

async function findPending(ctx: AppContext, invitationId: string) {
	const [row] = await ctx.db
		.select()
		.from(invitation)
		.where(and(eq(invitation.id, invitationId), isNull(invitation.acceptedAt)));
	if (!row) throw new AppError('not_found', '招待が見つかりません');
	return row;
}

export async function reissueInvitation(
	ctx: AppContext,
	invitationId: string
): Promise<{ url: string }> {
	authorize(ctx.actor, 'user:manage');
	const row = await findPending(ctx, invitationId);
	const projects = (await projectsOf(ctx.db, [row.id])).get(row.id) ?? [];
	const { url } = await createInvitation(
		ctx,
		{
			email: row.email,
			role: row.role,
			projectIds: projects.map((p) => p.id),
			name: row.name ?? ''
		},
		{ sendMail: false }
	);
	return { url };
}

export async function revokeInvitation(ctx: AppContext, invitationId: string): Promise<void> {
	authorize(ctx.actor, 'user:manage');
	await findPending(ctx, invitationId);
	await ctx.db.delete(invitation).where(eq(invitation.id, invitationId));
}

export interface PendingInvitation {
	id: string;
	email: string;
	role: Role;
	projects: { id: string; name: string }[];
	expiresAt: Date;
	expired: boolean;
}

export async function listPendingInvitations(
	ctx: AppContext,
	filter: { projectId?: string } = {}
): Promise<PendingInvitation[]> {
	authorize(ctx.actor, 'user:manage');
	const conds = [isNull(invitation.acceptedAt)];
	if (filter.projectId) {
		conds.push(
			inList(
				invitation.id,
				ctx.db
					.select({ id: invitationProject.invitationId })
					.from(invitationProject)
					.where(eq(invitationProject.projectId, filter.projectId))
			)
		);
	}
	const rows = await ctx.db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			expiresAt: invitation.expiresAt
		})
		.from(invitation)
		.where(and(...conds))
		.orderBy(desc(invitation.createdAt));
	const projects = await projectsOf(
		ctx.db,
		rows.map((r) => r.id)
	);
	const now = Date.now();
	return rows.map((r) => ({
		...r,
		projects: projects.get(r.id) ?? [],
		expired: r.expiresAt.getTime() < now
	}));
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
	const projects = (await projectsOf(db, [row.id])).get(row.id) ?? [];
	return {
		email: row.email,
		role: row.role,
		projectNames: projects.map((p) => p.name),
		name: row.name
	};
}

const AcceptInput = v.object({ token: v.string(), name: NameSchema, password: PasswordSchema });

export async function acceptInvitation(
	base: BaseContext,
	input: unknown
): Promise<{ email: string }> {
	const data = parse(AcceptInput, input);
	const inv = await findValidByToken(base.db, data.token);
	if (!inv) throw new AppError('not_found', INVALID_INVITE);
	const duplicate = new AppError('conflict', 'このメールアドレスのユーザーは既に登録されています');
	const [dup] = await base.db.select({ id: user.id }).from(user).where(eq(user.email, inv.email));
	if (dup) throw duplicate;
	const passwordHash = await base.hashPassword(data.password);

	// D1 はトランザクションを使えないので、先に招待を使用済みにし（条件付き update で 1 回だけ成功する）、
	// ユーザーの作成に失敗したら未使用に戻す
	const claimed = await base.db
		.update(invitation)
		.set({ acceptedAt: new Date() })
		.where(and(eq(invitation.id, inv.id), isNull(invitation.acceptedAt)))
		.returning({ id: invitation.id });
	if (claimed.length === 0) throw new AppError('not_found', INVALID_INVITE);
	const { id: userId, statements } = credentialUserInserts(base.db, {
		name: data.name,
		email: inv.email,
		role: inv.role,
		passwordHash
	});
	try {
		await base.db.batch([
			...statements,
			base.db.insert(projectMember).select(
				base.db
					.select({
						projectId: invitationProject.projectId,
						userId: sql<string>`${userId}`.as('userId')
					})
					.from(invitationProject)
					.where(eq(invitationProject.invitationId, inv.id))
			)
		]);
	} catch (e) {
		await base.db.update(invitation).set({ acceptedAt: null }).where(eq(invitation.id, inv.id));
		if (isUniqueViolation(e, 'user.email')) throw duplicate;
		throw e;
	}
	return { email: inv.email };
}
