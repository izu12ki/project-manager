import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { listIssueTypesOf, listStatusesOf } from '$lib/server/services/issue-fields';
import { requireProject } from '$lib/server/services/projects';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const project = await requireProject(ctx, params.key);
		const [statuses, issueTypes] = await Promise.all([
			listStatusesOf(ctx.db, project.id),
			listIssueTypesOf(ctx.db, project.id)
		]);
		return { project, statuses, issueTypes, isAdmin: ctx.actor.role === 'admin' };
	});
};
