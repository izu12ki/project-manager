import { can } from '#lib/server/authz.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { listIssueTypesOf, listStatusesOf } from '#lib/server/services/issue-fields.ts';
import { requireProject } from '#lib/server/services/projects.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const project = await requireProject(ctx, params.key);
		const [statuses, issueTypes] = await Promise.all([
			listStatusesOf(ctx.db, project.id),
			listIssueTypesOf(ctx.db, project.id)
		]);
		return {
			project,
			statuses,
			issueTypes,
			isAdmin: ctx.actor.role === 'admin',
			canCreateIssue: can(ctx.actor, 'issue:create'),
			canChangeStatus: can(ctx.actor, 'issue:changeStatus')
		};
	});
};
