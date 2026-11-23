import { describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import { createTestBase, createTestDb, ctxOf, roundTrips, seedProject, seedUser } from '../test-utils';
import { createInvitation, listPendingInvitations } from './invitations';
import {
	createCategory,
	createMilestone,
	listCategories,
	listIssueTypes,
	listMilestones
} from './issue-fields';
import { getProjectSettingsRows } from './project-settings';
import { listMembers, requireProject } from './projects';
import { listUsers } from './users';

describe('getProjectSettingsRows', () => {
	it('returns the same rows as the single-purpose functions in one round trip', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const as = (a: Actor) => ctxOf(base, a);
		const admin = await seedUser(db, 'admin', 'Admin');
		const member = await seedUser(db, 'member', 'Member');
		await seedUser(db, 'guest', 'Guest');
		const { id: acmeId } = await seedProject(db, { key: 'ACME', members: [member] });
		const { id: otherId } = await seedProject(db, { key: 'OTHER', name: 'Other' });
		for (const key of ['OTHER', 'ACME']) {
			await createCategory(as(admin), key, { name: `${key} カテゴリー` });
			await createMilestone(as(admin), key, { name: `${key} v1` });
		}
		await createInvitation(
			as(admin),
			{ email: 'both@example.com', role: 'member', projectIds: [acmeId, otherId] },
			{ sendMail: false }
		);
		await createInvitation(
			as(admin),
			{ email: 'other@example.com', role: 'guest', projectIds: [otherId] },
			{ sendMail: false }
		);

		const ctx = as(admin);
		const p = await requireProject(ctx, 'ACME');
		const before = roundTrips(db);
		const rows = await getProjectSettingsRows(ctx, 'ACME');
		expect(roundTrips(db) - before).toBe(1);
		expect(rows).toEqual({
			project: p,
			members: await listMembers(ctx, 'ACME'),
			users: await listUsers(ctx),
			invitations: await listPendingInvitations(ctx, { projectId: p.id }),
			issueTypes: await listIssueTypes(ctx, 'ACME'),
			categories: await listCategories(ctx, 'ACME'),
			milestones: await listMilestones(ctx, 'ACME')
		});
		expect(rows.invitations.map((i) => [i.email, i.projects.map((x) => x.name)])).toEqual([
			['both@example.com', ['Acme', 'Other']]
		]);

		await expect(getProjectSettingsRows(as(member), 'ACME')).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(getProjectSettingsRows(ctx, 'NOPE')).rejects.toMatchObject({
			code: 'not_found'
		});
	});
});
