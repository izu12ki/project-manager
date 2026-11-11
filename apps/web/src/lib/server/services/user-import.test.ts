import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BacklogUserRow, ImportRole } from '#lib/backlog-users.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { invitation, invitationProject, projectMember, user } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { createInvitation, getInvitationByToken } from './invitations';
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
		expect(result).toEqual({ invited: 2, joined: 1, skipped: { unselected: 1, inactive: 1 } });
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
		expect(down).toEqual({ invited: 0, joined: 0, skipped: { no_projects: 1 } });
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
		expect(result).toEqual({ invited: 0, joined: 0, skipped: { pending_invitation: 1 } });
		await Promise.all(base.pending);
		expect(await db.select().from(invitation)).toHaveLength(1);
		expect(base.sent).toHaveLength(1);
	});

	it('処理対象が 100 人を超えたら何も書かない', async () => {
		const rows = Array.from({ length: 101 }, () => send(row()));
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
});
