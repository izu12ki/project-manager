import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import {
	MY_ISSUES_LIMIT,
	listMyIssues,
	type MyIssueFilters
} from '#lib/server/services/my-issues.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams;
	const status = q.get('status');
	const filters: Required<MyIssueFilters> = {
		role: q.get('role') === 'reporter' ? 'reporter' : 'assignee',
		status: status === 'done' || status === 'all' ? status : 'open'
	};
	return handleLoad(async () => ({
		...(await listMyIssues(appContext(locals), filters)),
		filters,
		limit: MY_ISSUES_LIMIT
	}));
};
