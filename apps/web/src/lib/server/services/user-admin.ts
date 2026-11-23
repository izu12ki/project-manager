// ユーザー管理の画面（管理者だけ）に要る行を 1 回の batch（D1 への 1 往復）で引く
import { asc, isNull } from 'drizzle-orm';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { invitation, project } from '../db/schema';
import {
	invitationProjectsQuery,
	pendingInvitationsQuery,
	toPendingInvitations
} from './invitations';
import { usersQuery } from './users';

export async function getUserAdminRows(ctx: AppContext) {
	authorize(ctx.actor, 'user:manage');
	const { db } = ctx;
	const [users, invitations, invitationProjects, projects] = await ctx.readBatch([
		usersQuery(db),
		pendingInvitationsQuery(db),
		invitationProjectsQuery(
			db,
			db.select({ id: invitation.id }).from(invitation).where(isNull(invitation.acceptedAt))
		),
		// 招待で選べるプロジェクト（アーカイブしたものは除く）
		db.select().from(project).where(isNull(project.archivedAt)).orderBy(asc(project.name))
	]);
	return { users, invitations: toPendingInvitations(invitations, invitationProjects), projects };
}
