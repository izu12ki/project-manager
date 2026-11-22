import { redirect } from '@sveltejs/kit';
import { authorize, can } from '#lib/server/authz.ts';
import { appContext } from '#lib/server/context.ts';
import { handleAction, handleLoad } from '#lib/server/errors.ts';
import { listCategories, listMilestones } from '#lib/server/services/issue-fields.ts';
import { createIssue, listParentCandidates } from '#lib/server/services/issues.ts';
import { listAssignableUsers, requireProject } from '#lib/server/services/projects.ts';
import { formObject } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		authorize(ctx.actor, 'issue:create');
		const canAssign = can(ctx.actor, 'issue:assign');
		const [assignable, categories, milestones, parentCandidates] = await Promise.all([
			listAssignableUsers(ctx.db, p.id),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key),
			listParentCandidates(ctx, params.key)
		]);
		const wanted = Number(url.searchParams.get('parent'));
		const parent = parentCandidates.find((c) => c.number === wanted) ?? null;
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
