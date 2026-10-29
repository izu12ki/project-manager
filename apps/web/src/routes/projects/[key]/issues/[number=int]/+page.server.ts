import { redirect } from '@sveltejs/kit';
import { appContext } from '#lib/server/context.ts';
import { handleAction } from '#lib/server/errors.ts';
import { deleteIssue } from '#lib/server/services/issues.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	delete: async ({ locals, params }) =>
		handleAction(async () => {
			await deleteIssue(appContext(locals), params.key, params.number);
			redirect(303, `/projects/${params.key}`);
		})
};
