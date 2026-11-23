import { appContext } from '#lib/server/context.ts';
import { listProjectsWithOpenCounts } from '#lib/server/services/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return listProjectsWithOpenCounts(appContext(locals));
};
