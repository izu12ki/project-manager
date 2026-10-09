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

	it('名前と説明を更新できる', async () => {
		await seedProject(db, { key: 'ACME' });
		await updateProject(ctxOf(base, admin), 'ACME', { name: '新名称', description: '説明' });
		expect(await requireProject(ctxOf(base, admin), 'ACME')).toMatchObject({
			name: '新名称',
			description: '説明'
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
			assigneeId: guest.id,
			position: 'a0'
		});
		await removeMember(ctxOf(base, admin), 'ACME', guest.id);
		expect((await listMembers(ctxOf(base, admin), 'ACME')).map((m) => m.id)).toEqual([member.id]);
		const [i] = await db.select().from(issue).where(eq(issue.id, 'i1'));
		expect(i.assigneeId).toBeNull();
	});

	it('担当者候補は参加者（ゲスト含む）と admin。無効化ユーザーは除く', async () => {
		const { id } = await seedProject(db, { key: 'ACME', members: [member, guest] });
		const ids = (await listAssignableUsers(db, id)).map((u) => u.id).sort();
		expect(ids).toEqual([admin.id, member.id, guest.id].sort());
	});
});
