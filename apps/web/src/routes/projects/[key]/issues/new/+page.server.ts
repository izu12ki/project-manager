import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authz';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { createIssue } from '$lib/server/services/issues';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const canAssign = can(ctx.actor, 'issue:assign');
		return { canAssign, assignees: canAssign ? await listAssignableUsers(ctx.db, p.id) : [] };
	});
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { number } = await createIssue(appContext(locals), params.key, input);
			redirect(303, `/projects/${params.key}/issues/${number}`);
		});
	}
};
