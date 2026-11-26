import { and, eq, isNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { IMPORT_CHUNK, type BacklogUserRow, type ImportRole } from '#lib/backlog-users.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { invitation, invitationProject, projectMember, user } from '../db/schema';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import { createInvitation, getInvitationByToken, revokeInvitation } from './invitations';
import { importUsers, planUserImport } from './user-import';

let n = 0;
function row(over: Partial<BacklogUserRow> = {}): BacklogUserRow {
	n += 1;
	return {
		rowNumber: n + 1,
		name: `User ${n}`,
		email: `user${n}@example.com`,
		backlogRole: '一般ユーザー',
		status: '有効',
		projectKeys: ['DEMO'],
		...over
	};
}
const send = (r: BacklogUserRow, over: { include?: boolean; role?: ImportRole } = {}) => ({
	...r,
	include: true,
	role: 'member' as ImportRole,
	...over
});

describe('user-import', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor;
	let demoId: string;

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理者');
		({ id: demoId } = await seedProject(db, { key: 'DEMO', name: 'Demo' }));
	});

	const plan = (rows: BacklogUserRow[]) => planUserImport(ctxOf(base, admin), { rows });
	const seedWithEmail = async (role: 'admin' | 'member' | 'guest', email: string) => {
		const u = await seedUser(db, role);
		await db.update(user).set({ email }).where(eq(user.id, u.id));
		return { ...u, email };
	};

	it('admin 以外は使えない', async () => {
		const member = await seedUser(db, 'member');
		await expect(planUserImport(ctxOf(base, member), { rows: [] })).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(importUsers(ctxOf(base, member), { rows: [] })).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it('同じキーのプロジェクトに参加させ、ないキーとアーカイブ済みのキーを分けて返す', async () => {
		await seedProject(db, { key: 'WEB_APP', name: 'Web' });
		await seedProject(db, { key: 'OLD', name: 'Old', archived: true });
		const p = await plan([row({ projectKeys: ['WEB_APP', 'DEMO', 'MISSING', 'OLD'] })]);
		expect(p.rows[0].action).toBe('invite');
		expect(p.rows[0].projects.map((x) => x.key)).toEqual(['DEMO', 'WEB_APP']);
		expect(p.missingKeys).toEqual(['MISSING']);
		expect(p.archivedKeys).toEqual(['OLD']);
	});

	it('取り込まない人を理由付きで返す', async () => {
		const disabled = await seedWithEmail('member', 'disabled@example.com');
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, disabled.id));
		await createInvitation(ctxOf(base, admin), {
			email: 'pending@example.com',
			role: 'member',
			projectIds: [demoId]
		});
		const p = await plan([
			row({ status: '無効' }),
			row({ email: 'bad' }),
			row({ email: 'a@example.com' }),
			row({ email: 'A@Example.com' }),
			row({ email: 'Disabled@example.com' }),
			row({ email: 'pending@example.com' })
		]);
		expect(p.rows.map((r) => r.reason)).toEqual([
			'inactive',
			'invalid_email',
			null,
			'duplicate',
			'disabled_user',
			'pending_invitation'
		]);
	});

	it('既存ユーザーはメールの大文字小文字を無視して、足りないプロジェクトだけ参加を追加する', async () => {
		await seedProject(db, { key: 'WEB_APP', name: 'Web' });
		const m = await seedWithEmail('member', 'member@example.com');
		await db.insert(projectMember).values({ projectId: demoId, userId: m.id });
		const a = await seedWithEmail('admin', 'boss@example.com');
		const p = await plan([
			row({ email: 'Member@example.com', projectKeys: ['DEMO', 'WEB_APP'] }),
			row({ email: 'member@example.com', projectKeys: ['DEMO'] }),
			row({ email: 'boss@example.com', projectKeys: ['DEMO', 'WEB_APP'] })
		]);
		expect(p.rows[0]).toMatchObject({ action: 'join', role: 'member' });
		expect(p.rows[0].projects.map((x) => x.key)).toEqual(['WEB_APP']);
		expect(p.rows[1]).toMatchObject({ action: 'skip', reason: 'duplicate' });
		expect(a.role).toBe('admin');
		expect(p.rows[2]).toMatchObject({ action: 'skip', reason: 'already_joined' });
		const p2 = await plan([row({ email: 'member@example.com', projectKeys: ['DEMO'] })]);
		expect(p2.rows[0].reason).toBe('already_joined');
	});

	it('期限切れの招待しかない人は招待する', async () => {
		await createInvitation(ctxOf(base, admin), {
			email: 'old@example.com',
			role: 'member',
			projectIds: [demoId]
		});
		await db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) });
		const r = row({ email: 'old@example.com' });
		expect((await plan([r])).rows[0].action).toBe('invite');
		await importUsers(ctxOf(base, admin), { rows: [send(r)] });
		const pending = await db
			.select()
			.from(invitation)
			.where(and(eq(invitation.email, 'old@example.com'), isNull(invitation.acceptedAt)));
		expect(pending).toHaveLength(1);
	});

	it('取り込むと招待メールを送り、参加を追加し、理由別に数える', async () => {
		const m = await seedWithEmail('member', 'exist@example.com');
		const [a, b, j, off, inactive] = [
			row({ name: 'Alice' }),
			row({ name: 'Bob' }),
			row({ email: 'exist@example.com' }),
			row({}),
			row({ status: '無効' })
		];
		const result = await importUsers(ctxOf(base, admin), {
			rows: [
				send(a),
				send(b, { role: 'guest' }),
				send(j),
				send(off, { include: false }),
				send(inactive)
			]
		});
		expect(result).toEqual({
			invited: 2,
			joined: 1,
			skipped: { unselected: 1, inactive: 1 },
			inviteFailed: [],
			mailFailed: []
		});
		await Promise.all(base.pending);
		expect(base.sent).toHaveLength(2);
		const invs = await db.select().from(invitation);
		expect(invs.find((i) => i.email === b.email)).toMatchObject({ role: 'guest', name: 'Bob' });
		expect(invs.find((i) => i.email === a.email)).toMatchObject({ role: 'member', name: 'Alice' });
		const pm = await db.select().from(projectMember).where(eq(projectMember.userId, m.id));
		expect(pm.map((x) => x.projectId)).toEqual([demoId]);
	});

	it('ロールをメンバーに下げた、参加プロジェクトのない人は招待しない', async () => {
		const r = row({ projectKeys: [], backlogRole: '管理者' });
		const p = await plan([r]);
		expect(p.rows[0]).toMatchObject({ action: 'invite', role: 'admin', projects: [] });
		const down = await importUsers(ctxOf(base, admin), { rows: [send(r, { role: 'member' })] });
		expect(down).toEqual({
			invited: 0,
			joined: 0,
			skipped: { no_projects: 1 },
			inviteFailed: [],
			mailFailed: []
		});
		await Promise.all(base.pending);
		expect(base.sent).toHaveLength(0);
		const up = await importUsers(ctxOf(base, admin), { rows: [send(r, { role: 'admin' })] });
		expect(up.invited).toBe(1);
		expect(await db.select().from(invitationProject)).toHaveLength(0);
	});

	it('確認の後に別の管理者が招待していたら、二重に招待しない', async () => {
		const r = row();
		await plan([r]);
		await createInvitation(ctxOf(base, admin), {
			email: r.email,
			role: 'member',
			projectIds: [demoId]
		});
		const result = await importUsers(ctxOf(base, admin), { rows: [send(r)] });
		expect(result).toEqual({
			invited: 0,
			joined: 0,
			skipped: { pending_invitation: 1 },
			inviteFailed: [],
			mailFailed: []
		});
		await Promise.all(base.pending);
		expect(await db.select().from(invitation)).toHaveLength(1);
		expect(base.sent).toHaveLength(1);
	});

	it('1 回に送られた処理対象が IMPORT_CHUNK 人を超えたら何も書かない', async () => {
		const rows = Array.from({ length: IMPORT_CHUNK + 1 }, () => send(row()));
		await expect(importUsers(ctxOf(base, admin), { rows })).rejects.toMatchObject({
			code: 'validation'
		});
		await Promise.all(base.pending);
		expect(await db.select().from(invitation)).toHaveLength(0);
		expect(base.sent).toHaveLength(0);
	});

	it('名前が 50 文字を超える人は名前なしで招待する', async () => {
		const r = row({ name: 'a'.repeat(51) });
		await importUsers(ctxOf(base, admin), { rows: [send(r)] });
		await Promise.all(base.pending);
		const url = base.sent[0].text.match(/http\S+\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? '';
		expect((await getInvitationByToken(db, url))?.name).toBeNull();
	});

	it('確認画面で選べなかった行は、その後に招待できるようになっても招待しない', async () => {
		const r = row();
		const ctx = ctxOf(base, admin);
		await createInvitation(
			ctx,
			{ email: r.email, role: 'member', projectIds: [demoId] },
			{ sendMail: false }
		);
		expect((await plan([r])).rows[0].reason).toBe('pending_invitation');
		// 確認画面を出した後に、別のタブで招待が取り消された
		const [inv] = await db.select({ id: invitation.id }).from(invitation);
		await revokeInvitation(ctx, inv.id);
		const result = await importUsers(ctx, { rows: [send(r, { include: false })] });
		expect(result.invited).toBe(0);
		expect(result.skipped).toEqual({ unselected: 1 });
		await Promise.all(base.pending);
		expect(await db.select().from(invitation)).toHaveLength(0);
		expect(base.sent).toHaveLength(0);
	});

	it('参加できるプロジェクトがなく選べなかった行は、チェックなしで送られても理由をそのまま数える', async () => {
		const r = row({ projectKeys: [] });
		const result = await importUsers(ctxOf(base, admin), { rows: [send(r, { include: false })] });
		expect(result.invited).toBe(0);
		expect(result.skipped).toEqual({ no_projects: 1 });
	});

	it('招待メールは間隔を空けて 1 通ずつ送り、送れなかった人も招待したうえで数える', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		onTestFinished(() => err.mockRestore());
		const delivered: { to: string; at: number }[] = [];
		const flaky = createTestBase(db, {
			mailer: {
				send: async (m) => {
					if (m.to === 'fail@example.com') throw new Error('429 Too Many Requests');
					delivered.push({ to: m.to, at: Date.now() });
				}
			}
		});
		const rows = ['a@example.com', 'fail@example.com', 'c@example.com'].map((email) =>
			send(row({ email }))
		);
		const result = await importUsers(ctxOf(flaky, admin), { rows });
		expect(result).toEqual({
			invited: 3,
			joined: 0,
			skipped: {},
			inviteFailed: [],
			mailFailed: [{ name: rows[1].name, email: 'fail@example.com' }]
		});
		// 後回しにせず、リクエストの中で送り終えている。画面を閉じられても続くよう waitUntil にも渡す
		expect(delivered.map((d) => d.to)).toEqual(['a@example.com', 'c@example.com']);
		expect(flaky.pending).toHaveLength(1);
		// a →（120ms）→ fail →（120ms）→ c
		expect(delivered[1].at - delivered[0].at).toBeGreaterThanOrEqual(200);
		const invs = await db.select({ email: invitation.email }).from(invitation);
		expect(invs.map((i) => i.email).sort()).toEqual([
			'a@example.com',
			'c@example.com',
			'fail@example.com'
		]);
		expect(err).toHaveBeenCalledWith('invitation mail failed', expect.any(Error));
	});

	it('Cloudflare の無料プランで確認していない宛先に送れなかったら、そのことを結果に入れる', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		onTestFinished(() => err.mockRestore());
		const restricted = createTestBase(db, {
			mailer: {
				send: async () => {
					throw Object.assign(new Error('recipient not allowed by plan'), {
						code: 'E_RECIPIENT_PLAN_RESTRICTED'
					});
				}
			}
		});
		const result = await importUsers(ctxOf(restricted, admin), {
			rows: [send(row({ email: 'a@example.com' }))]
		});
		expect(result.mailFailed).toHaveLength(1);
		expect(result.mailRestricted).toBe(true);
	});

	it('途中の人の招待に失敗しても、残りの人を招待し、作れた招待のメールを送る', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		onTestFinished(() => err.mockRestore());
		// この人の招待だけ DB への書き込みで失敗させる
		await db.run(
			sql.raw(`CREATE TRIGGER fail_invite BEFORE INSERT ON invitation
				WHEN NEW.email = 'boom@example.com' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
		);
		const rows = ['a@example.com', 'boom@example.com', 'c@example.com'].map((email) =>
			send(row({ email }))
		);
		const result = await importUsers(ctxOf(base, admin), { rows });
		expect(result).toEqual({
			invited: 2,
			joined: 0,
			skipped: {},
			inviteFailed: [{ name: rows[1].name, email: 'boom@example.com' }],
			mailFailed: []
		});
		expect(base.sent.map((m) => m.to)).toEqual(['a@example.com', 'c@example.com']);
		const invs = await db.select({ email: invitation.email }).from(invitation);
		expect(invs.map((i) => i.email).sort()).toEqual(['a@example.com', 'c@example.com']);
		expect(err).toHaveBeenCalledWith('invitation failed', expect.any(Error));
	});

	it('IMPORT_CHUNK 人の招待と参加の追加は、D1 無料プランの 1 リクエスト 50 クエリに収まる', async () => {
		const joiner = await seedWithEmail('member', 'joiner@example.com');
		const rows = [
			send(row({ email: joiner.email })),
			...Array.from({ length: IMPORT_CHUNK - 1 }, () => send(row()))
		];
		const before = roundTrips(db);
		const r = await importUsers(ctxOf(base, admin), { rows });
		await Promise.all(base.pending);
		// hooks のセッション確認など、取り込み以外の問い合わせの分（5 回）を残す
		expect(roundTrips(db) - before).toBeLessThanOrEqual(45);
		expect(r).toMatchObject({ invited: IMPORT_CHUNK - 1, joined: 1 });
	});
});
