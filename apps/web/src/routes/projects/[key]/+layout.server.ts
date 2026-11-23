import { can } from '#lib/server/authz.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { getProjectLayoutRows } from '#lib/server/services/project-access.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const { project, statuses, issueTypes } = await getProjectLayoutRows(ctx, params.key);
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
