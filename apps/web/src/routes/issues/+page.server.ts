import { redirect } from '@sveltejs/kit';
import { ISSUE_PAGE_SIZE, lastPage, parsePage, withPage } from '#lib/pagination.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { listMyIssues, type MyIssueFilters } from '#lib/server/services/my-issues.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams;
	const status = q.get('status');
	const filters: Required<MyIssueFilters> = {
		role: q.get('role') === 'reporter' ? 'reporter' : 'assignee',
		status: status === 'done' || status === 'all' ? status : 'open'
	};
	const page = parsePage(q);
	const { issues, total } = await handleLoad(() => listMyIssues(appContext(locals), filters, page));
	// 課題が減った後の古いリンクなどで最後のページを越えたら、最後のページへ
	const last = lastPage(total, ISSUE_PAGE_SIZE);
	if (page > last) redirect(303, `${url.pathname}${withPage(q, last)}`);
	return { issues, total, page, filters };
};
