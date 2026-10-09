import { appContext } from '$lib/server/context';
import { listProjects } from '$lib/server/services/projects';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, projects: [] };
	const projects = await listProjects(appContext(locals));
	return {
		user: locals.user,
		projects: projects.map((p) => ({ key: p.key, name: p.name, archived: !!p.archivedAt }))
	};
};
