import { redirect } from '@sveltejs/kit';
import { can } from '#lib/server/authz.ts';
import { appContext } from '#lib/server/context.ts';
import { handleAction, handleLoad } from '#lib/server/errors.ts';
import { getNewIssueRows } from '#lib/server/services/issue-list.ts';
import { createIssue } from '#lib/server/services/issues.ts';
import { formObject } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const wanted = Number(url.searchParams.get('parent'));
		const { assignable, categories, milestones, parentCandidates, parent } = await getNewIssueRows(
			ctx,
			params.key,
			Number.isSafeInteger(wanted) && wanted > 0 ? wanted : undefined
		);
		const canAssign = can(ctx.actor, 'issue:assign');
		return {
			canAssign,
			canSetStatus: can(ctx.actor, 'issue:changeStatus'),
			assignees: canAssign ? assignable : [],
			mentionCandidates: assignable.map(({ id, name }) => ({ id, name })),
			categories,
			milestones: milestones.filter((m) => !m.completedAt),
			parentCandidates,
			parent
		};
	});
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const input = {
			...formObject(fd),
			assigneeIds: fd.getAll('assigneeIds').map(String),
			categoryIds: fd.getAll('categoryIds').map(String)
		};
		return handleAction(async () => {
			const { number } = await createIssue(appContext(locals), params.key, input);
			redirect(303, `/projects/${params.key}/issues/${number}`);
		});
	}
};
