import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import { createIssueType, createStatus, listIssueTypesOf, listStatusesOf } from './issue-fields';
import { getProjectLayoutRows } from './project-access';
import { requireProject } from './projects';

describe('getProjectLayoutRows', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', 'Admin');
		member = await seedUser(db, 'member', 'Member');
		guest = await seedUser(db, 'guest', 'Guest');
		outsider = await seedUser(db, 'member', 'Outsider');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		// 別のプロジェクトのステータス・種別が混ざらないこと
		await seedProject(db, { key: 'OTHER', members: [outsider] });
		await createStatus(as(admin), 'OTHER', { name: '別プロジェクトの状態', color: 'blue' });
		await createIssueType(as(admin), 'OTHER', { name: '別プロジェクトの種別', color: 'blue' });
		await createStatus(as(admin), 'ACME', { name: '確認待ち', color: 'teal' });
		await createIssueType(as(admin), 'ACME', { name: '問い合わせ', color: 'amber' });
	});

	it('returns the same rows as requireProject, listStatusesOf and listIssueTypesOf', async () => {
		for (const actor of [member, guest, admin]) {
			const p = await requireProject(as(actor), 'ACME');
			expect(await getProjectLayoutRows(as(actor), 'ACME')).toEqual({
				project: p,
				statuses: await listStatusesOf(db, p.id),
				issueTypes: await listIssueTypesOf(db, p.id)
			});
		}
	});

	it('hides projects the actor has not joined', async () => {
		await expect(getProjectLayoutRows(as(outsider), 'ACME')).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(getProjectLayoutRows(as(admin), 'NOPE')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('reads everything in one round trip', async () => {
		const before = roundTrips(db);
		await getProjectLayoutRows(as(member), 'ACME');
		expect(roundTrips(db) - before).toBe(1);
	});
});
