import { describe, expect, it } from 'vitest';
import {
	createTestBase,
	createTestDb,
	ctxOf,
	roundTrips,
	seedProject,
	seedUser
} from '../test-utils';
import { createInvitation, listPendingInvitations } from './invitations';
import { listProjects } from './projects';
import { getUserAdminRows } from './user-admin';
import { listUsers } from './users';

describe('getUserAdminRows', () => {
	it('returns the same rows as the single-purpose functions in one round trip', async () => {
		const db = await createTestDb();
		const base = createTestBase(db);
		const admin = await seedUser(db, 'admin', 'Admin');
		const member = await seedUser(db, 'member', 'Member');
		const { id: acmeId } = await seedProject(db, { key: 'ACME', members: [member] });
		await seedProject(db, { key: 'OLD', name: 'Old', archived: true });
		const ctx = ctxOf(base, admin);
		await createInvitation(
			ctx,
			{ email: 'new@example.com', role: 'guest', projectIds: [acmeId] },
			{ sendMail: false }
		);
		await createInvitation(ctx, { email: 'boss@example.com', role: 'admin' }, { sendMail: false });

		const before = roundTrips(db);
		const rows = await getUserAdminRows(ctx);
		expect(roundTrips(db) - before).toBe(1);
		expect(rows).toEqual({
			users: await listUsers(ctx),
			invitations: await listPendingInvitations(ctx),
			projects: (await listProjects(ctx)).filter((p) => !p.archivedAt)
		});
		const projectsByEmail = Object.fromEntries(
			rows.invitations.map((i) => [i.email, i.projects.map((p) => p.name)])
		);
		expect(projectsByEmail).toEqual({ 'boss@example.com': [], 'new@example.com': ['Acme'] });
		expect(rows.projects.map((p) => p.key)).toEqual(['ACME']);
		await expect(getUserAdminRows(ctxOf(base, member))).rejects.toMatchObject({
			code: 'forbidden'
		});
	});
});
