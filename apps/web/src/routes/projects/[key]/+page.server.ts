import { redirect } from '@sveltejs/kit';
import { parseIssueSort } from '#lib/issue-sort.ts';
import { PRIORITIES, type Priority } from '#lib/labels.ts';
import { ISSUE_PAGE_SIZE, lastPage, parsePage, withPage } from '#lib/pagination.ts';
import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { getIssueListRows } from '#lib/server/services/issue-list.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	const q = url.searchParams;
	const priority = q.get('priority');
	const status = q.get('status');
	const filters = {
		// 既定は完了以外。'all' はすべて
		status: status === 'all' ? undefined : status || 'open',
		// 開始日・期限のどちらもない課題（タイムラインの「未設定の課題を一覧で見る」から来る）
		unscheduled: q.get('dates') === 'none' || undefined,
		typeId: q.get('type') || undefined,
		priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
		assigneeId: q.get('assignee') || undefined,
		categoryId: q.get('category') || undefined,
		milestoneId: q.get('milestone') || undefined,
		q: q.get('q')?.trim().slice(0, 200) || undefined
	};
	const sort = parseIssueSort(q);
	const page = parsePage(q);
	const rows = await handleLoad(() => getIssueListRows(ctx, params.key, filters, sort, page));
	// 課題が減った後の古いリンクなどで最後のページを越えたら、最後のページへ
	const last = lastPage(rows.total, ISSUE_PAGE_SIZE);
	if (page > last) redirect(303, `${url.pathname}${withPage(q, last)}`);
	const { issues, total, assignees, categories, milestones, deletedIssues } = rows;
	return { issues, total, page, assignees, categories, milestones, deletedIssues, filters, sort };
};
