import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/labels';
import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { listCategories, listMilestones } from '$lib/server/services/issue-fields';
import { listIssues } from '$lib/server/services/issues';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	const q = url.searchParams;
	const status = q.get('status');
	const priority = q.get('priority');
	const filters = {
		status: STATUSES.includes(status as Status) ? (status as Status) : undefined,
		priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
		assigneeId: q.get('assignee') || undefined,
		categoryId: q.get('category') || undefined,
		milestoneId: q.get('milestone') || undefined,
		q: q.get('q')?.trim().slice(0, 200) || undefined
	};
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [issues, assignees, categories, milestones] = await Promise.all([
			listIssues(ctx, params.key, filters),
			listAssignableUsers(ctx.db, p.id),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key)
		]);
		return { issues, assignees, categories, milestones, filters };
	});
};
