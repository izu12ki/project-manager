import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { listBoard, moveIssue } from '$lib/server/services/issues';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => ({ columns: await listBoard(ctx, params.key) }));
};

export const actions: Actions = {
	move: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await moveIssue(appContext(locals), params.key, input);
			return { moved: true };
		});
	}
};
