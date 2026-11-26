// プロジェクトの設定画面（管理者だけ）に要る行を 1 回の batch（D1 への 1 往復）で引く。方式は project-access.ts の先頭を参照
import { and, isNull } from 'drizzle-orm';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { inList } from '../db/limits';
import { invitation, invitationProject } from '../db/schema';
import {
	invitationProjectsQuery,
	pendingInvitationsQuery,
	toPendingInvitations
} from './invitations';
import { categoriesQuery, issueTypesQuery, milestonesQuery } from './issue-fields';
import { cachedByKey, checkProjectAccess, ofProject, projectAccessRead } from './project-access';
import { membersQuery } from './projects';
import { usersQuery } from './users';

export async function getProjectSettingsRows(ctx: AppContext, key: string) {
	authorize(ctx.actor, 'user:manage');
	const { db } = ctx;
	const of = ofProject(db, key);
	// このプロジェクトに参加する、受諾されていない招待の ID（参加プロジェクトの名前を引くのに使う）
	const pendingIds = db
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				isNull(invitation.acceptedAt),
				inList(
					invitation.id,
					db
						.select({ id: invitationProject.invitationId })
						.from(invitationProject)
						.where(of(invitationProject.projectId))
				)
			)
		);
	const [
		access,
		members,
		users,
		invitations,
		invitationProjects,
		issueTypes,
		categories,
		milestones
	] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		membersQuery(db, of),
		usersQuery(db),
		pendingInvitationsQuery(db, of),
		invitationProjectsQuery(db, pendingIds),
		// レイアウトも引く（同じ文は 1 回だけ送る。db/read-batch.ts）
		cachedByKey(issueTypesQuery)(db, key),
		cachedByKey(categoriesQuery)(db, key),
		cachedByKey(milestonesQuery)(db, key)
	]);
	return {
		project: checkProjectAccess(ctx, access),
		members,
		users,
		invitations: toPendingInvitations(invitations, invitationProjects),
		issueTypes,
		categories,
		milestones
	};
}
