import { appContext } from '#lib/server/context.ts';
import { countOpenIssues } from '#lib/server/services/issues.ts';
import { listProjects } from '#lib/server/services/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	const projects = await listProjects(ctx);
	const active = projects.filter((p) => !p.archivedAt);
	const openCounts = await countOpenIssues(
		ctx,
		active.map((p) => p.id)
	);
	return {
		active: active.map((p) => ({ ...p, openCount: openCounts[p.id] ?? 0 })),
		archived: projects.filter((p) => p.archivedAt)
	};
};
