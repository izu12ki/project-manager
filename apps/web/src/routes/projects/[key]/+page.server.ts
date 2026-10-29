import { PRIORITIES, type Priority } from '#lib/labels.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { listCategories, listMilestones } from '#lib/server/services/issue-fields.ts';
import { listDeletedIssues, listIssues } from '#lib/server/services/issues.ts';
import { listAssignableUsers, requireProject } from '#lib/server/services/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	const q = url.searchParams;
	const priority = q.get('priority');
	const filters = {
		status: q.get('status') || undefined,
		typeId: q.get('type') || undefined,
		priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
		assigneeId: q.get('assignee') || undefined,
		categoryId: q.get('category') || undefined,
		milestoneId: q.get('milestone') || undefined,
		q: q.get('q')?.trim().slice(0, 200) || undefined
	};
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [issues, assignees, categories, milestones, deletedIssues] = await Promise.all([
			listIssues(ctx, params.key, filters),
			listAssignableUsers(ctx.db, p.id),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key),
			listDeletedIssues(ctx, params.key)
		]);
		return { issues, assignees, categories, milestones, deletedIssues, filters };
	});
};
