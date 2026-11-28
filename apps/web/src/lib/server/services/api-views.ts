import * as v from 'valibot';
import type { Status } from '#lib/labels.ts';
import { AppError } from '../errors';
import { parse } from '../validation';
import { apiUser } from '../api';
import type { AppContext } from '../context';
import { getCommentRows } from './comments';
import { DEFAULT_ISSUE_SORT } from '#lib/issue-sort.ts';
import {
	listFilterConds,
	getIssue,
	issueListQuery,
	sortOrder,
	toIssueListItems,
	type IssueFilters
} from './issues';
import { countQuery } from './issue-list';
import { checkProjectAccess, ofProject, projectAccessRead } from './project-access';
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
	assignees: { id: string; name: string }[];
	parentNumber: number | null;
	startDate: string | null;
	dueDate: string | null;
	categoryIds: string[];
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
	assignees: { id: string; name: string }[];
	parentNumber: number | null;
	startDate: string | null;
	dueDate: string | null;
	categoryIds: string[];
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
		assignees: i.assignees.map(apiUser),
		parentNumber: i.parentNumber,
		startDate: i.startDate,
		dueDate: i.dueDate,
		categoryIds: i.categoryIds,
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

/**
 * API の課題一覧。そのページの分と件数だけを、プロジェクトの確認と合わせて 1 回の batch（D1 への 1 往復）で読む。
 * 全件を読んでから切り出すと、課題の多いプロジェクトで 1 回ごとの D1 の読み取りと CPU 時間が課題の数だけ増えるため
 */
export async function listApiIssues(ctx: AppContext, key: string, query: URLSearchParams) {
	const { limit = 100, offset = 0 } = parse(ListQuery, {
		limit: query.get('limit') ?? undefined,
		offset: query.get('offset') ?? undefined
	});
	const filters: IssueFilters = {
		status: (query.get('status') || undefined) as Status | undefined,
		assigneeId: query.get('assigneeId') || undefined,
		typeId: query.get('typeId') || undefined,
		categoryId: query.get('categoryId') || undefined,
		milestoneId: query.get('milestoneId') || undefined,
		q: query.get('q') || undefined
	};
	const { db } = ctx;
	const where = listFilterConds(key, ofProject(db, key), filters);
	const [access, rows, [{ total }]] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		issueListQuery(db, where, sortOrder(DEFAULT_ISSUE_SORT)).limit(limit).offset(offset),
		countQuery(db, where)
	]);
	const p = checkProjectAccess(ctx, access);
	return {
		items: toIssueListItems(rows).map((r) => apiIssue(ctx, p.key, r)),
		total,
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
	return {
		...apiIssue(ctx, p.key, { ...i, parentNumber: i.parent?.number ?? null }),
		description: i.description
	};
}

export type ApiComment = {
	id: string;
	author: { id: string; name: string };
	body: string;
	createdAt: string;
	updatedAt: string;
	url: string;
	reactions: { emoji: string; users: { id: string; name: string }[] }[];
};

/** 課題のコメント（古い順）。削除した課題は課題の取得と同じく 404 */
async function apiComments(ctx: AppContext, key: string, number: number): Promise<ApiComment[]> {
	const { project: p, issue, comments } = await getCommentRows(ctx, key, number);
	if (issue.deletedAt) throw new AppError('not_found', '課題が見つかりません');
	const issueUrl = `${projectUrl(ctx, p.key)}/issues/${number}`;
	return comments.map((c) => ({
		id: c.id,
		author: apiUser({ id: c.authorId, name: c.authorName }),
		body: c.body,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
		url: `${issueUrl}#comment-${c.id}`,
		reactions: c.reactions.map((r) => ({ emoji: r.emoji, users: r.users.map(apiUser) }))
	}));
}

export async function listApiComments(
	ctx: AppContext,
	key: string,
	number: number,
	query: URLSearchParams
) {
	const { limit = 100, offset = 0 } = parse(ListQuery, {
		limit: query.get('limit') ?? undefined,
		offset: query.get('offset') ?? undefined
	});
	const all = await apiComments(ctx, key, number);
	return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

export async function getApiComment(
	ctx: AppContext,
	key: string,
	number: number,
	id: string
): Promise<ApiComment> {
	const c = (await apiComments(ctx, key, number)).find((x) => x.id === id);
	if (!c) throw new AppError('not_found', 'コメントが見つかりません');
	return c;
}

const CREATE_KEYS = [
	'title',
	'description',
	'typeId',
	'status',
	'priority',
	'assigneeIds',
	'parentNumber',
	'startDate',
	'dueDate',
	'categoryIds',
	'milestoneId'
];
// resolution は起票では受け付けない（起票時は未完了のため）
const ALLOWED_KEYS = {
	create: CREATE_KEYS,
	update: [...CREATE_KEYS, 'resolution'],
	bulkUpdate: [...CREATE_KEYS, 'resolution', 'number'],
	comment: ['body']
} as const;
export type ApiInputKind = keyof typeof ALLOWED_KEYS;

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

const UNKNOWN_MSG = '不明な項目です';

function unknownKeys(body: Record<string, unknown>, kind: ApiInputKind): string[] {
	const allowed: readonly string[] = ALLOWED_KEYS[kind];
	return Object.keys(body).filter((k) => !allowed.includes(k));
}

/** API の null（クリア）をサービス層の空文字に変える。undefined のキーは落とす */
function convert(body: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(body)
			.filter(([, val]) => val !== undefined)
			.map(([k, val]) => [k, val === null ? '' : val])
	);
}

/** 単発の本文を検証用に変換する。許可リスト外のキーは 400 */
export function toServiceInput(body: unknown, kind: Exclude<ApiInputKind, 'bulkUpdate'>): unknown {
	if (!isRecord(body)) return body;
	const unknown = unknownKeys(body, kind);
	if (unknown.length > 0) {
		throw new AppError(
			'validation',
			`不明な項目があります: ${unknown.join(', ')}`,
			Object.fromEntries(unknown.map((k) => [k, [UNKNOWN_MSG]]))
		);
	}
	return convert(body);
}

/** 一括の本文を変換する。全要素の不明キーを集めてからまとめて 400 にする */
export function toBulkServiceInput(body: unknown, kind: 'create' | 'bulkUpdate'): unknown {
	if (!isRecord(body)) return body;
	const fields: Record<string, string[]> = {};
	for (const k of Object.keys(body)) if (k !== 'items') fields[k] = [UNKNOWN_MSG];
	const items = body.items;
	const converted = Array.isArray(items)
		? items.map((item, i) => {
				if (!isRecord(item)) return item;
				for (const k of unknownKeys(item, kind)) fields[`items.${i}.${k}`] = [UNKNOWN_MSG];
				return convert(item);
			})
		: items;
	const names = Object.keys(fields);
	if (names.length > 0) {
		throw new AppError('validation', `不明な項目があります: ${names.join(', ')}`, fields);
	}
	return { ...body, items: converted };
}
