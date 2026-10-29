import { redirect } from '@sveltejs/kit';
import { appContext } from '#lib/server/context.ts';
import { handleAction } from '#lib/server/errors.ts';
import { createProject } from '#lib/server/services/projects.ts';
import { formObject } from '#lib/server/validation.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { key } = await createProject(appContext(locals), input);
			redirect(303, `/projects/${key}`);
		});
	}
};
