import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { requireProject } from '$lib/server/services/projects';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	const project = await handleLoad(() => requireProject(ctx, params.key));
	return { project, isAdmin: ctx.actor.role === 'admin' };
};
