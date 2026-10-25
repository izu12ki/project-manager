import * as v from 'valibot';
import type { Status } from '$lib/labels';
import { AppError } from '../errors';
import { parse } from '../validation';
import { apiUser } from '../api';
import type { AppContext } from '../context';
import { getIssue, listIssues } from './issues';
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

export type ApiIssue = {
	key: string;
	number: number;
	title: string;
	typeId: string | null;
	status: string;
	resolution: string | null;
	priority: string;
	assignee: { id: string; name: string } | null;
	startDate: string | null;
	dueDate: string | null;
	categoryId: string | null;
	milestoneId: string | null;
	url: string;
	updatedAt: string;
};

type IssueSource = {
	number: number;
	title: string;
	typeId: string | null;
	status: string;
	resolution: string | null;
	priority: string;
	assigneeId: string | null;
	assigneeName: string | null;
	startDate: string | null;
	dueDate: string | null;
	categoryId: string | null;
	milestoneId: string | null;
	updatedAt: Date;
};

function apiIssue(ctx: AppContext, projectKey: string, i: IssueSource): ApiIssue {
	return {
		key: `${projectKey}-${i.number}`,
		number: i.number,
		title: i.title,
		typeId: i.typeId,
		status: i.status,
		resolution: i.resolution,
		priority: i.priority,
		assignee: i.assigneeId ? apiUser({ id: i.assigneeId, name: i.assigneeName ?? '' }) : null,
		startDate: i.startDate,
		dueDate: i.dueDate,
		categoryId: i.categoryId,
		milestoneId: i.milestoneId,
		url: `${projectUrl(ctx, projectKey)}/issues/${i.number}`,
		updatedAt: i.updatedAt.toISOString()
	};
}

const intParam = (min: number, max: number, msg: string) =>
	v.optional(
		v.pipe(
			v.string(),
			v.regex(/^\d+$/, msg),
			v.transform(Number),
			v.minValue(min, msg),
			v.maxValue(max, msg)
		)
	);

const ListQuery = v.object({
	limit: intParam(1, 500, 'limit は 1〜500 の整数で指定してください'),
	offset: intParam(0, Number.MAX_SAFE_INTEGER, 'offset は 0 以上の整数で指定してください')
});

export async function listApiIssues(ctx: AppContext, key: string, query: URLSearchParams) {
	const { limit = 100, offset = 0 } = parse(ListQuery, {
		limit: query.get('limit') ?? undefined,
		offset: query.get('offset') ?? undefined
	});
	const p = await requireProject(ctx, key);
	const rows = await listIssues(ctx, key, {
		status: (query.get('status') || undefined) as Status | undefined,
		assigneeId: query.get('assigneeId') || undefined,
		typeId: query.get('typeId') || undefined,
		categoryId: query.get('categoryId') || undefined,
		milestoneId: query.get('milestoneId') || undefined,
		q: query.get('q') || undefined
	});
	return {
		items: rows.slice(offset, offset + limit).map((r) => apiIssue(ctx, p.key, r)),
		total: rows.length,
		limit,
		offset
	};
}

export async function getApiIssue(
	ctx: AppContext,
	key: string,
	number: number
): Promise<ApiIssue & { description: string }> {
	const { project: p, issue: i } = await getIssue(ctx, key, number);
	if (i.deletedAt) throw new AppError('not_found', '課題が見つかりません');
	return { ...apiIssue(ctx, p.key, i), description: i.description };
}

/** API の null（クリア）をサービス層の空文字に変える。undefined のキーは落とす */
export function toServiceInput(body: unknown): unknown {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
	return Object.fromEntries(
		Object.entries(body)
			.filter(([, val]) => val !== undefined)
			.map(([k, val]) => [k, val === null ? '' : val])
	);
}
