import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { issue } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import {
	addMember,
	assertWritable,
	createProject,
	listAssignableUsers,
	listMembers,
	listProjects,
	removeMember,
	requireProject,
	setProjectArchived,
	updateProject
} from './projects';
import { listIssueTypes, listStatuses } from './issue-fields';

describe('projects', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		outsider = await seedUser(db, 'member', 'outsider');
	});

	it('キーにはアンダースコアと 25 文字までの長さを使える', async () => {
		const ctx = ctxOf(base, admin);
		expect(await createProject(ctx, { key: 'web_app', name: 'W' })).toEqual({ key: 'WEB_APP' });
		expect(await createProject(ctx, { key: 'A'.repeat(25), name: 'L' })).toEqual({
			key: 'A'.repeat(25)
		});
		for (const key of ['A'.repeat(26), '_ABC', 'A', 'AB-C', '1AB']) {
			await expect(createProject(ctx, { key, name: 'X' })).rejects.toMatchObject({
				code: 'validation',
				message: 'キーは英字で始まる2〜25文字の英数字とアンダースコア（_）で入力してください'
			});
		}
		expect(await updateProject(ctx, 'WEB_APP', { key: 'long_project_key_01', name: 'W' })).toEqual({
			key: 'LONG_PROJECT_KEY_01'
		});
	});

	it('admin はキーを大文字にしてプロジェクトを作れる。重複キーは conflict', async () => {
		expect(
			await createProject(ctxOf(base, admin), { key: 'acme', name: 'Acme', description: '' })
		).toEqual({ key: 'ACME' });
		await expect(
			createProject(ctxOf(base, admin), { key: 'ACME', name: 'X', description: '' })
		).rejects.toMatchObject({ code: 'conflict' });
		await expect(
			createProject(ctxOf(base, admin), { key: '1BAD', name: 'X', description: '' })
		).rejects.toMatchObject({ code: 'validation' });
		await expect(
			createProject(ctxOf(base, member), { key: 'NEW', name: 'X', description: '' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('参加していないプロジェクトは一覧に出ず、開くと not_found', async () => {
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'OTHER' });
		expect((await listProjects(ctxOf(base, admin))).map((p) => p.key).sort()).toEqual([
			'ACME',
			'OTHER'
		]);
		expect((await listProjects(ctxOf(base, guest))).map((p) => p.key)).toEqual(['ACME']);
		await expect(requireProject(ctxOf(base, guest), 'OTHER')).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(requireProject(ctxOf(base, outsider), 'ACME')).rejects.toMatchObject({
			code: 'not_found'
		});
		expect((await requireProject(ctxOf(base, admin), 'OTHER')).key).toBe('OTHER');
	});

	it('アーカイブすると書き込み不可', async () => {
		await seedProject(db, { key: 'ACME' });
		await setProjectArchived(ctxOf(base, admin), 'ACME', true);
		const p = await requireProject(ctxOf(base, admin), 'ACME');
		expect(() => assertWritable(p)).toThrow();
		await setProjectArchived(ctxOf(base, admin), 'ACME', false);
		expect(() => assertWritable(p)).toThrow(); // 取得済みの行は古いまま
		const fresh = await requireProject(ctxOf(base, admin), 'ACME');
		expect(() => assertWritable(fresh)).not.toThrow();
	});

	it('memo があればリクエスト内で共有し、更新後は取り直す', async () => {
		await seedProject(db, { key: 'ACME', members: [member] });
		const ctx = ctxOf({ ...base, memo: new Map() }, member);
		expect(requireProject(ctx, 'ACME')).toBe(requireProject(ctx, 'ACME'));
		const adminCtx = ctxOf({ ...base, memo: new Map() }, admin);
		await requireProject(adminCtx, 'ACME');
		await setProjectArchived(adminCtx, 'ACME', true);
		expect((await requireProject(adminCtx, 'ACME')).archivedAt).not.toBeNull();
	});

	it('名前と説明を更新できる', async () => {
		await seedProject(db, { key: 'ACME' });
		await updateProject(ctxOf(base, admin), 'ACME', { name: '新名称', description: '説明' });
		expect(await requireProject(ctxOf(base, admin), 'ACME')).toMatchObject({
			name: '新名称',
			description: '説明'
		});
	});

	it('作成すると既定のステータスと課題種別が用意される', async () => {
		await createProject(ctxOf(base, admin), { key: 'NEW', name: 'New' });
		const ctx = ctxOf(base, admin);
		expect((await listStatuses(ctx, 'NEW')).map((s) => s.name)).toEqual([
			'未着手',
			'進行中',
			'レビュー',
			'完了'
		]);
		expect((await listIssueTypes(ctx, 'NEW')).map((t) => t.name)).toEqual([
			'タスク',
			'バグ',
			'要望',
			'その他'
		]);
	});

	it('キー・アイコン・色を変更できる。キーの重複は conflict', async () => {
		await seedProject(db, { key: 'ACME' });
		await seedProject(db, { key: 'BETA' });
		const ctx = ctxOf(base, admin);
		const input = { name: 'Acme', description: '', icon: '🚀', color: 'teal' };
		await expect(updateProject(ctx, 'ACME', { ...input, key: 'beta' })).rejects.toMatchObject({
			code: 'conflict'
		});
		expect(await updateProject(ctx, 'ACME', { ...input, key: 'acme2' })).toEqual({ key: 'ACME2' });
		expect(await requireProject(ctx, 'ACME2')).toMatchObject({ icon: '🚀', color: 'teal' });
		await expect(requireProject(ctx, 'ACME')).rejects.toMatchObject({ code: 'not_found' });
		await updateProject(ctx, 'ACME2', { ...input, icon: '', color: '' });
		expect(await requireProject(ctx, 'ACME2')).toMatchObject({ icon: null, color: null });
		await expect(updateProject(ctx, 'ACME2', { ...input, icon: 'abc' })).rejects.toMatchObject({
			code: 'validation'
		});
		await expect(updateProject(ctx, 'ACME2', { ...input, color: 'purple' })).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('参加者の追加・削除。削除するとそのプロジェクトの担当が外れる', async () => {
		const { id } = await seedProject(db, { key: 'ACME', members: [member] });
		await addMember(ctxOf(base, admin), 'ACME', guest.id);
		await addMember(ctxOf(base, admin), 'ACME', guest.id); // 2 回目は何もしない
		expect((await listMembers(ctxOf(base, admin), 'ACME')).map((m) => m.id).sort()).toEqual(
			[member.id, guest.id].sort()
		);
		await expect(addMember(ctxOf(base, admin), 'ACME', admin.id)).rejects.toMatchObject({
			code: 'validation'
		});

		await db.insert(issue).values({
			id: 'i1',
			projectId: id,
			number: 1,
			title: 't',
			reporterId: member.id,
			assigneeIds: [guest.id, member.id],
			position: 'a0'
		});
		await removeMember(ctxOf(base, admin), 'ACME', guest.id);
		expect((await listMembers(ctxOf(base, admin), 'ACME')).map((m) => m.id)).toEqual([member.id]);
		const [i] = await db.select().from(issue).where(eq(issue.id, 'i1'));
		expect(i.assigneeIds).toEqual([member.id]);
	});

	it('担当者候補は参加者（ゲスト含む）と admin。無効化ユーザーは除く', async () => {
		const { id } = await seedProject(db, { key: 'ACME', members: [member, guest] });
		const ids = (await listAssignableUsers(db, id)).map((u) => u.id).sort();
		expect(ids).toEqual([admin.id, member.id, guest.id].sort());
	});
});
