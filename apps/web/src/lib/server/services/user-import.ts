import { and, asc, gte, inArray, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import {
	inviteAllowed,
	MAX_CSV_USERS,
	MAX_IMPORT_USERS,
	roleFromBacklog,
	type BacklogUserRow,
	type ImportRole,
	type UserImportResult,
	type UserImportSkip
} from '#lib/backlog-users.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { invitation, project, projectMember, user } from '../db/schema';
import { AppError } from '../errors';
import type { MailMessage } from '../mailer';
import { EmailSchema, NameSchema, parse } from '../validation';
import { createInvitation } from './invitations';

export interface UserImportPlanRow {
	rowNumber: number;
	name: string;
	email: string; // 小文字にそろえたもの（不正なら入力のまま）
	backlogRole: string;
	/** invite: roleFromBacklog の既定値。join: 既存ユーザーの今のロール */
	role: ImportRole;
	/** invite: 参加させるプロジェクト。join: 追加するプロジェクト。名前順 */
	projects: { id: string; key: string; name: string }[];
	action: 'invite' | 'join' | 'skip';
	/** action が 'skip' のときだけ。'no_projects' と 'unselected' はここには出ない */
	reason: UserImportSkip | null;
}
export interface UserImportPlan {
	rows: UserImportPlanRow[];
	missingKeys: string[];
	archivedKeys: string[];
}

const Text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const RowSchema = v.object({
	rowNumber: v.number(),
	name: Text(200),
	email: Text(320),
	backlogRole: Text(100),
	status: Text(100),
	projectKeys: v.pipe(v.array(Text(100)), v.maxLength(1000))
});
const PlanInput = v.object({ rows: v.pipe(v.array(RowSchema), v.maxLength(MAX_CSV_USERS)) });
const ImportInput = v.object({
	rows: v.pipe(
		v.array(
			v.object({
				...RowSchema.entries,
				include: v.boolean(),
				role: v.picklist(['admin', 'member', 'guest'])
			})
		),
		v.maxLength(MAX_CSV_USERS)
	)
});

/**
 * まとめて招待するときの、招待メールを送る間隔。
 * メール送信サービスの上限（Resend は 1 秒に 10 回）を超えないようにする
 */
const MAIL_INTERVAL_MS = 120;

const byName = (a: { name: string }, b: { name: string }) =>
	a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

async function buildPlan(ctx: AppContext, rows: BacklogUserRow[]): Promise<UserImportPlan> {
	const keys = [...new Set(rows.flatMap((r) => r.projectKeys))].sort();
	const emails = [
		...new Set(
			rows.flatMap((r) => {
				const e = v.safeParse(EmailSchema, r.email);
				return e.success ? [e.output] : [];
			})
		)
	];

	const projects =
		keys.length === 0
			? []
			: await ctx.db
					.select({
						id: project.id,
						key: project.key,
						name: project.name,
						archivedAt: project.archivedAt
					})
					.from(project)
					.where(inArray(project.key, keys))
					.orderBy(asc(project.name));
	const projectByKey = new Map(projects.map((p) => [p.key, p]));

	const users =
		emails.length === 0
			? []
			: await ctx.db
					.select({ id: user.id, email: user.email, role: user.role, disabledAt: user.disabledAt })
					.from(user)
					.where(inArray(sql`lower(${user.email})`, emails));
	const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

	const members =
		users.length === 0
			? []
			: await ctx.db
					.select({ userId: projectMember.userId, projectId: projectMember.projectId })
					.from(projectMember)
					.where(
						inArray(
							projectMember.userId,
							users.map((u) => u.id)
						)
					);
	const joined = new Map<string, Set<string>>();
	for (const m of members) {
		joined.set(m.userId, (joined.get(m.userId) ?? new Set()).add(m.projectId));
	}

	const pending =
		emails.length === 0
			? []
			: await ctx.db
					.select({ email: invitation.email })
					.from(invitation)
					.where(
						and(
							inArray(invitation.email, emails),
							isNull(invitation.acceptedAt),
							gte(invitation.expiresAt, new Date())
						)
					);
	const pendingEmails = new Set(pending.map((p) => p.email.toLowerCase()));

	const seen = new Set<string>();
	const planRows = rows.map((r): UserImportPlanRow => {
		const parsed = v.safeParse(EmailSchema, r.email);
		const email = parsed.success ? parsed.output : r.email;
		const targets = [
			...new Map(
				r.projectKeys.flatMap((k) => {
					const p = projectByKey.get(k);
					return p && p.archivedAt === null
						? [[p.id, { id: p.id, key: p.key, name: p.name }] as const]
						: [];
				})
			).values()
		].sort(byName);
		const base = {
			rowNumber: r.rowNumber,
			name: r.name,
			email,
			backlogRole: r.backlogRole,
			role: roleFromBacklog(r.backlogRole)
		};
		const skip = (reason: UserImportSkip, role = base.role): UserImportPlanRow => ({
			...base,
			role,
			projects: targets,
			action: 'skip',
			reason
		});

		if (r.status !== '有効') return skip('inactive');
		if (!parsed.success) return skip('invalid_email');
		if (seen.has(email)) return skip('duplicate');
		seen.add(email);

		const existing = userByEmail.get(email);
		if (existing) {
			if (existing.disabledAt) return skip('disabled_user', existing.role);
			const has = joined.get(existing.id) ?? new Set<string>();
			const missing = targets.filter((p) => !has.has(p.id));
			if (existing.role === 'admin' || missing.length === 0) {
				return skip('already_joined', existing.role);
			}
			return { ...base, role: existing.role, projects: missing, action: 'join', reason: null };
		}
		if (pendingEmails.has(email)) return skip('pending_invitation');
		return { ...base, projects: targets, action: 'invite', reason: null };
	});

	const missingKeys = keys.filter((k) => !projectByKey.has(k));
	const archivedKeys = keys.filter((k) => projectByKey.get(k)?.archivedAt);
	return { rows: planRows, missingKeys, archivedKeys };
}

export async function planUserImport(ctx: AppContext, input: unknown): Promise<UserImportPlan> {
	authorize(ctx.actor, 'user:manage');
	const data = parse(PlanInput, input);
	return buildPlan(ctx, data.rows);
}

export async function importUsers(ctx: AppContext, input: unknown): Promise<UserImportResult> {
	authorize(ctx.actor, 'user:manage');
	const data = parse(ImportInput, input);
	// クライアントの計画は信用せず、送られた行から作り直す
	const plan = await buildPlan(ctx, data.rows);

	const skipped: UserImportResult['skipped'] = {};
	const count = (reason: UserImportSkip) => {
		skipped[reason] = (skipped[reason] ?? 0) + 1;
	};
	const invites: { row: UserImportPlanRow; role: ImportRole }[] = [];
	const joins: UserImportPlanRow[] = [];
	// 確認画面で選べなかった行（取り込まない理由がある行）は、チェックの有無にかかわらずその理由で数える。
	// 確認画面の後に招待できるようになった行も、チェックが付いていなければ招待しない
	plan.rows.forEach((row, i) => {
		const sent = data.rows[i];
		if (row.action === 'skip') return count(row.reason ?? 'inactive');
		if (row.action === 'invite' && !inviteAllowed(sent.role, row.projects.length)) {
			return count('no_projects');
		}
		if (!sent.include) return count('unselected');
		if (row.action === 'invite') invites.push({ row, role: sent.role });
		else joins.push(row);
	});

	if (invites.length + joins.length > MAX_IMPORT_USERS) {
		throw new AppError(
			'validation',
			`一度に取り込めるのは${MAX_IMPORT_USERS}人までです。チェックを外して分けて取り込んでください`
		);
	}

	if (joins.length > 0) {
		const userRows = await ctx.db
			.select({ id: user.id, email: user.email })
			.from(user)
			.where(
				inArray(
					sql`lower(${user.email})`,
					joins.map((j) => j.email)
				)
			);
		const idByEmail = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));
		const values = joins.flatMap((j) =>
			j.projects.map((p) => ({ projectId: p.id, userId: idByEmail.get(j.email) as string }))
		);
		await ctx.db.insert(projectMember).values(values).onConflictDoNothing();
	}

	const mails: MailMessage[] = [];
	for (const { row, role } of invites) {
		const name = v.safeParse(NameSchema, row.name);
		const { mail } = await createInvitation(
			ctx,
			{
				email: row.email,
				role,
				projectIds: row.projects.map((p) => p.id),
				name: name.success ? name.output : ''
			},
			{ sendMail: false }
		);
		mails.push(mail);
	}

	// 一度に送るとメール送信サービスに断られるので、リクエストの中で 1 通ずつ間隔を空けて送る。
	// 送れなかった人も招待はできているので、数を返して「リンクを再発行」で渡してもらう
	let mailFailed = 0;
	for (const [i, mail] of mails.entries()) {
		if (i > 0) await new Promise((resolve) => setTimeout(resolve, MAIL_INTERVAL_MS));
		try {
			await ctx.mailer.send(mail);
		} catch (e) {
			console.error('invitation mail failed', e);
			mailFailed += 1;
		}
	}
	return { invited: invites.length, joined: joins.length, skipped, mailFailed };
}
