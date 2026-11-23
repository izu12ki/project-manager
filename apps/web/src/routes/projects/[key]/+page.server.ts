import { parseIssueSort } from '#lib/issue-sort.ts';
import { PRIORITIES, type Priority } from '#lib/labels.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { getIssueListRows } from '#lib/server/services/issue-list.ts';
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
	const sort = parseIssueSort(q);
	return handleLoad(async () => {
		const { issues, assignees, categories, milestones, deletedIssues } = await getIssueListRows(
			ctx,
			params.key,
			filters,
			sort
		);
		return { issues, assignees, categories, milestones, deletedIssues, filters, sort };
	});
};
