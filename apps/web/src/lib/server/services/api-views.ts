import { apiUser } from '../api';
import type { AppContext } from '../context';
import { listIssueTypes, listMilestones, listCategories, listStatuses } from './issue-fields';
import { listAssignableUsers, listProjects, requireProject, type ProjectRow } from './projects';

const projectUrl = (ctx: AppContext, key: string) =>
	`${ctx.baseUrl.replace(/\/$/, '')}/projects/${key}`;

function summary(ctx: AppContext, p: ProjectRow) {
	return { key: p.key, name: p.name, archived: !!p.archivedAt, url: projectUrl(ctx, p.key) };
}

export async function listProjectSummaries(ctx: AppContext) {
	return (await listProjects(ctx)).map((p) => summary(ctx, p));
}

export async function getProjectDetail(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	const [statuses, types, categories, milestones, members] = await Promise.all([
		listStatuses(ctx, key),
		listIssueTypes(ctx, key),
		listCategories(ctx, key),
		listMilestones(ctx, key),
		listAssignableUsers(ctx.db, p.id)
	]);
	return {
		...summary(ctx, p),
		description: p.description,
		timelineUrl: `${projectUrl(ctx, p.key)}/timeline`,
		statuses: statuses.map((s) => ({ key: s.key, name: s.name })),
		types: types.map((t) => ({ id: t.id, name: t.name })),
		categories: categories.map((c) => ({ id: c.id, name: c.name })),
		milestones: milestones.map((m) => ({
			id: m.id,
			name: m.name,
			releaseDate: m.releaseDate,
			completed: !!m.completedAt
		})),
		members: members.map(apiUser)
	};
}
