import { appContext } from '#lib/server/context.ts';
import { listProjects } from '#lib/server/services/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// レイアウトと同じ一覧。同じ文は 1 回だけ D1 へ送る（db/read-batch.ts）
	const projects = await listProjects(appContext(locals));
	return {
		active: projects.filter((p) => !p.archivedAt),
		archived: projects.filter((p) => p.archivedAt)
	};
};
