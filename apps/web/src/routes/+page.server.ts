import { appContext } from '$lib/server/context';
import { listProjects } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const projects = await listProjects(appContext(locals));
	return {
		active: projects.filter((p) => !p.archivedAt),
		archived: projects.filter((p) => p.archivedAt)
	};
};
