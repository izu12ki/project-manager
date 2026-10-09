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
		const [p] = await ctx.db
			.select({ name: project.name })
			.from(project)
			.where(eq(project.id, projectId));
		if (!p)
			throw new AppError('validation', 'プロジェクトが見つかりません', {
				projectId: ['プロジェクトが見つかりません']
			});
		projectName = p.name;
	}
	const [existing] = await ctx.db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, data.email));
	if (existing)
		throw new AppError('conflict', 'このメールアドレスのユーザーは既に登録されています');

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
				.send({
					to: data.email,
					...invitationMail({ url, inviterName: ctx.actor.name, projectName })
				})
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

export async function reissueInvitation(
	ctx: AppContext,
	invitationId: string
): Promise<{ url: string }> {
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
		const [p] = await db
			.select({ name: project.name })
			.from(project)
			.where(eq(project.id, row.projectId));
		projectName = p?.name ?? null;
	}
	return { email: row.email, role: row.role, projectName };
}

const AcceptInput = v.object({ token: v.string(), name: NameSchema, password: PasswordSchema });

export async function acceptInvitation(
	base: BaseContext,
	input: unknown
): Promise<{ email: string }> {
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
