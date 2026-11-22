import { and, asc, count, desc, eq, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { inList } from '../db/limits';
import { alias } from 'drizzle-orm/sqlite-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import {
	DONE_STATUS,
	INITIAL_STATUS,
	type IssueChangeItem,
	type Priority,
	type Status,
	type StatusDef
} from '#lib/labels.ts';
import { DEFAULT_ISSUE_SORT, type IssueSort } from '#lib/issue-sort.ts';
import { authorize, can } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { category, issue, issueChange, issueType, milestone, project, user } from '../db/schema';
import { AppError } from '../errors';
import { notify } from '../notifications';
import { emptyToNull, parse } from '../validation';
import { linkAttachments } from './attachment-links';
import { listStatusesOf } from './issue-fields';
import {
	StatusSchema,
	assertStatusIn,
	categoryIdsValue,
	createEventsOf,
	describeChanges,
	loadFieldSets,
	loadFormerAssigneeNames,
	prepareCreate,
	preparePatch,
	type IssuePatch,
	type IssueRow,
	updateEventsOf,
	withCategoryGuard
} from './issue-input';
import { assertWritable, forgetProject, requireProject, type ProjectRow } from './projects';

const STALE = '並び順が古くなっています。画面を再読み込みしてください';

/**
 * assigneeId / categoryId はその人・カテゴリーを含む課題、'none' は 1 つもない課題。
 * typeId / milestoneId は 'none' で未設定のものに絞る。q はタイトルか番号の部分一致。
 */
export interface IssueFilters {
	status?: Status;
	typeId?: string;
	assigneeId?: string;
	priority?: Priority;
	categoryId?: string;
	milestoneId?: string;
	q?: string;
}

const parent = alias(issue, 'parent');
const reporter = alias(user, 'reporter');
const deleter = alias(user, 'deleter');

const listColumns = {
	id: issue.id,
	number: issue.number,
	title: issue.title,
	typeId: issue.typeId,
	typeName: issueType.name,
	typeColor: issueType.color,
	status: issue.status,
	resolution: issue.resolution,
	priority: issue.priority,
	startDate: issue.startDate,
	dueDate: issue.dueDate,
	position: issue.position,
	assigneeIds: issue.assigneeIds,
	parentId: issue.parentId,
	parentNumber: parent.number,
	categoryIds: issue.categoryIds,
	milestoneId: issue.milestoneId,
	milestoneName: milestone.name,
	reporterId: issue.reporterId,
	createdAt: issue.createdAt,
	updatedAt: issue.updatedAt
};

export type IssueListItem = Awaited<ReturnType<typeof selectIssues>>[number];
export type AssigneeRef = { id: string; name: string };
export type CategoryRef = { id: string; name: string };

/** assigneeIds の順に名前を付ける。名前が引けない人（存在しない ID）は除く */
export async function withAssignees<T extends { assigneeIds: string[] }>(
	db: DB,
	rows: T[]
): Promise<(T & { assignees: AssigneeRef[] })[]> {
	const ids = [...new Set(rows.flatMap((r) => r.assigneeIds))];
	const users =
		ids.length === 0
			? []
			: await db.select({ id: user.id, name: user.name }).from(user).where(inList(user.id, ids));
	const names = new Map(users.map((u) => [u.id, u.name]));
	return rows.map((r) => ({
		...r,
		assignees: r.assigneeIds.flatMap((id) => {
			const name = names.get(id);
			return name === undefined ? [] : [{ id, name }];
		})
	}));
}

/** カテゴリーの名前を付ける。プロジェクトのカテゴリー順に並べ、存在しない ID は除く */
export async function withCategories<T extends { categoryIds: string[] }>(
	db: DB,
	rows: T[]
): Promise<(T & { categories: CategoryRef[] })[]> {
	const ids = [...new Set(rows.flatMap((r) => r.categoryIds))];
	const categories =
		ids.length === 0
			? []
			: await db
					.select({ id: category.id, name: category.name })
					.from(category)
					.where(inList(category.id, ids))
					.orderBy(asc(category.createdAt), asc(category.id));
	return rows.map((r) => ({
		...r,
		categories: categories.filter((c) => r.categoryIds.includes(c.id))
	}));
}

async function selectIssues(db: DB, where: SQL | undefined, order: SQL[]) {
	const rows = await db
		.select(listColumns)
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.leftJoin(issueType, eq(issue.typeId, issueType.id))
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.where(where)
		.orderBy(...order);
	const [named, categorized] = await Promise.all([
		withAssignees(db, rows),
		withCategories(db, rows)
	]);
	return named.map((r, i) => ({ ...r, categories: categorized[i].categories }));
}

/** ID の配列の列で絞る。'none' は空配列、それ以外はその ID を含む課題 */
function idsCond(
	col: typeof issue.assigneeIds | typeof issue.categoryIds,
	value: string | undefined
): SQL | undefined {
	if (!value) return undefined;
	if (value === 'none') return sql`json_array_length(${col}) = 0`;
	return sql`exists (select 1 from json_each(${col}) where value = ${value})`;
}

function optionCond(
	col: typeof issue.typeId | typeof issue.milestoneId,
	value: string | undefined
): SQL | undefined {
	if (!value) return undefined;
	return value === 'none' ? isNull(col) : eq(col, value);
}

/** タイトルの部分一致。「ACME-12」「#12」「12」は番号の一致としても扱う。 */
function keywordCond(projectKey: string, q: string | undefined): SQL | undefined {
	const kw = q?.trim();
	if (!kw) return undefined;
	const escaped = kw.replace(/[\\%_]/g, (c) => `\\${c}`);
	const title = sql`${issue.title} like ${`%${escaped}%`} escape '\\'`;
	const m = kw.match(new RegExp(`^(?:${projectKey}-|#)?(\\d{1,9})$`, 'i'));
	return m ? or(title, eq(issue.number, Number(m[1]))) : title;
}

function filterConds(p: ProjectRow, filters: IssueFilters): SQL | undefined {
	return and(
		eq(issue.projectId, p.id),
		isNull(issue.deletedAt),
		filters.status ? eq(issue.status, filters.status) : undefined,
		filters.priority ? eq(issue.priority, filters.priority) : undefined,
		idsCond(issue.assigneeIds, filters.assigneeId),
		idsCond(issue.categoryIds, filters.categoryId),
		optionCond(issue.typeId, filters.typeId),
		optionCond(issue.milestoneId, filters.milestoneId),
		keywordCond(p.key, filters.q)
	);
}

/** 並べ替えの ORDER BY。日付が空の課題は、どちらの向きでも末尾に置く。同じ値の中はキーの降順 */
function sortOrder(sort: IssueSort): SQL[] {
	const dir = sort.order === 'asc' ? asc : desc;
	const byDate = (col: typeof issue.startDate | typeof issue.dueDate) => [
		sql`${col} is null`,
		dir(col)
	];
	switch (sort.key) {
		case 'number':
			return [dir(issue.number)];
		case 'start':
			return [...byDate(issue.startDate), desc(issue.number)];
		case 'due':
			return [...byDate(issue.dueDate), desc(issue.number)];
		case 'created':
			return [dir(issue.createdAt), desc(issue.number)];
		case 'updated':
			return [dir(issue.updatedAt), desc(issue.number)];
	}
}

export async function listIssues(
	ctx: AppContext,
	key: string,
	filters: IssueFilters = {},
	sort: IssueSort = DEFAULT_ISSUE_SORT
) {
	const p = await requireProject(ctx, key);
	return selectIssues(ctx.db, filterConds(p, filters), sortOrder(sort));
}

/** プロジェクトごとの未完了（完了以外）の課題数。projectIds は呼び出し側で閲覧可能なものに限ること。 */
export async function countOpenIssues(
	ctx: AppContext,
	projectIds: string[]
): Promise<Record<string, number>> {
	if (projectIds.length === 0) return {};
	const rows = await ctx.db
		.select({ projectId: issue.projectId, n: count() })
		.from(issue)
		.where(
			and(
				inList(issue.projectId, projectIds),
				ne(issue.status, DONE_STATUS),
				isNull(issue.deletedAt)
			)
		)
		.groupBy(issue.projectId);
	return Object.fromEntries(rows.map((r) => [r.projectId, r.n]));
}

/** 列はプロジェクトのステータス順。絞り込んだ場合も、カード間の並び順は全体の position を保つ。 */
export async function listBoard(
	ctx: AppContext,
	key: string,
	filters: Omit<IssueFilters, 'status'> = {}
): Promise<{ statuses: StatusDef[]; columns: Record<Status, IssueListItem[]> }> {
	const p = await requireProject(ctx, key);
	const [statuses, rows] = await Promise.all([
		listStatusesOf(ctx.db, p.id),
		selectIssues(ctx.db, filterConds(p, { ...filters, status: undefined }), [
			asc(issue.position),
			asc(issue.number)
		])
	]);
	const columns: Record<Status, IssueListItem[]> = Object.fromEntries(
		statuses.map((s) => [s.key, [] as IssueListItem[]])
	);
	// 定義が消えたステータスの課題は初期ステータスの列に出す
	for (const r of rows) (columns[r.status] ?? columns[INITIAL_STATUS])?.push(r);
	return { statuses, columns };
}

export type TimelineItem = IssueListItem & { canEdit: boolean };

/**
 * タイムライン用。日付のある課題はすべて（完了を含む）、日付のない課題は未完了のものだけ返す。
 * 表示範囲では絞らない（範囲外の課題にも行を出すため）。並べ替え・グループ化はクライアント側で行う。
 */
export async function listTimeline(
	ctx: AppContext,
	key: string
): Promise<{ scheduled: TimelineItem[]; unscheduled: TimelineItem[] }> {
	const p = await requireProject(ctx, key);
	const rows = await selectIssues(ctx.db, filterConds(p, {}), [asc(issue.number)]);
	const items = rows.map((r) => ({
		...r,
		canEdit: !p.archivedAt && can(ctx.actor, 'issue:edit', { reporterId: r.reporterId })
	}));
	return {
		scheduled: items.filter((i) => i.startDate || i.dueDate),
		unscheduled: items.filter((i) => !i.startDate && !i.dueDate && i.status !== DONE_STATUS)
	};
}

export async function getIssue(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	const [row] = await ctx.db
		.select({
			issue,
			parentNumber: parent.number,
			parentTitle: parent.title,
			reporterName: reporter.name,
			deletedByName: deleter.name
		})
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.innerJoin(reporter, eq(issue.reporterId, reporter.id))
		.leftJoin(deleter, eq(issue.deletedBy, deleter.id))
		.where(and(eq(issue.projectId, p.id), eq(issue.number, number)));
	if (!row) throw new AppError('not_found', '課題が見つかりません');
	const [withNames] = await withAssignees(ctx.db, [row.issue]);
	return {
		project: p as ProjectRow,
		issue: {
			...withNames,
			parent:
				row.parentNumber === null ? null : { number: row.parentNumber, title: row.parentTitle! },
			reporterName: row.reporterName,
			deletedByName: row.deletedByName
		}
	};
}

/**
 * 親にできる課題（新しい順）。子課題は 1 階層までなので、子課題でない課題だけ。
 * 削除したものと、exceptNumber（親を設定しようとしている課題自身）は除く
 */
export async function listParentCandidates(ctx: AppContext, key: string, exceptNumber?: number) {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select({ number: issue.number, title: issue.title })
		.from(issue)
		.where(
			and(
				eq(issue.projectId, p.id),
				isNull(issue.parentId),
				isNull(issue.deletedAt),
				exceptNumber === undefined ? undefined : ne(issue.number, exceptNumber)
			)
		)
		.orderBy(desc(issue.number));
}

/** 削除した課題は閲覧だけできる */
export function assertNotDeleted(i: { deletedAt: Date | null }): void {
	if (i.deletedAt) throw new AppError('conflict', '削除された課題は変更できません');
}

/** 削除履歴（新しい順） */
export async function listDeletedIssues(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select({
			number: issue.number,
			title: issue.title,
			deletedAt: issue.deletedAt,
			deletedByName: deleter.name
		})
		.from(issue)
		.leftJoin(deleter, eq(issue.deletedBy, deleter.id))
		.where(and(eq(issue.projectId, p.id), isNotNull(issue.deletedAt)))
		.orderBy(desc(issue.deletedAt));
}

async function nextPosition(db: DB, projectId: string, status: Status): Promise<string> {
	const [row] = await db
		.select({ max: sql<string | null>`max(${issue.position})` })
		.from(issue)
		.where(and(eq(issue.projectId, projectId), eq(issue.status, status)));
	return generateKeyBetween(row?.max ?? null, null);
}

export async function createIssue(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<{ number: number }> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const fields = await loadFieldSets(ctx.db, p.id);
	const values = prepareCreate(ctx.actor, fields, input);
	const position = await nextPosition(ctx.db, p.id, values.status);
	await ctx.db.batch([
		ctx.db
			.update(project)
			.set({ nextIssueNumber: sql`${project.nextIssueNumber} + 1` })
			.where(eq(project.id, p.id)),
		ctx.db.insert(issue).values({
			...values,
			categoryIds: categoryIdsValue(p.id, values.categoryIds ?? []),
			projectId: p.id,
			number: sql`(select ${project.nextIssueNumber} - 1 from ${project} where ${project.id} = ${p.id})`,
			position
		})
	]);
	const { id } = values;
	await linkAttachments(ctx, { projectId: p.id, issueId: id }, values.description);
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const [row] = await ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id));
	await notify(ctx, {
		project: p,
		issue: { id, number: row.number, title: values.title },
		events: createEventsOf(values)
	});
	return { number: row.number };
}

/** 課題を更新し、同時に編集履歴を残す */
async function applyPatch(
	ctx: AppContext,
	cur: IssueRow,
	patch: IssuePatch,
	changes: IssueChangeItem[]
): Promise<void> {
	const update = ctx.db
		.update(issue)
		.set(withCategoryGuard(cur.projectId, patch))
		.where(eq(issue.id, cur.id));
	if (changes.length === 0) {
		await update;
		return;
	}
	await ctx.db.batch([
		update,
		ctx.db
			.insert(issueChange)
			.values({ id: uuidv7(), issueId: cur.id, actorId: ctx.actor.id, changes })
	]);
}

/** 編集履歴（古い順）。課題が存在しない場合は空配列 */
export async function listIssueChanges(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	return ctx.db
		.select({
			id: issueChange.id,
			actorId: issueChange.actorId,
			actorName: user.name,
			changes: issueChange.changes,
			createdAt: issueChange.createdAt
		})
		.from(issueChange)
		.innerJoin(user, eq(user.id, issueChange.actorId))
		.innerJoin(issue, eq(issue.id, issueChange.issueId))
		.where(and(eq(issue.projectId, p.id), eq(issue.number, number)))
		.orderBy(asc(issueChange.createdAt), asc(issueChange.id));
}

/** 未送信（undefined）の項目は変更しない。値が変わった項目だけ権限を確認する。 */
export async function updateIssue(
	ctx: AppContext,
	key: string,
	number: number,
	input: unknown
): Promise<void> {
	const p = await requireProject(ctx, key);
	const [{ issue: cur }, fields] = await Promise.all([
		getIssue(ctx, key, number),
		loadFieldSets(ctx.db, p.id)
	]);
	assertWritable(p);
	assertNotDeleted(cur);
	const patch = preparePatch(ctx.actor, fields, cur, input);
	if (Object.keys(patch).length === 0) return;
	if (patch.status !== undefined) {
		patch.position = await nextPosition(ctx.db, p.id, patch.status);
	}
	const otherUsers = await loadFormerAssigneeNames(ctx.db, fields, [{ cur, patch }]);
	await applyPatch(ctx, cur, patch, describeChanges(fields, cur, patch, otherUsers));
	if (patch.description !== undefined) {
		await linkAttachments(ctx, { projectId: p.id, issueId: cur.id }, patch.description);
	}
	const events = updateEventsOf(cur, patch);
	if (events.length > 0) {
		await notify(ctx, {
			project: p,
			issue: { id: cur.id, number: cur.number, title: patch.title ?? cur.title },
			events
		});
	}
}

const MoveInput = v.object({
	issueId: v.string(),
	status: StatusSchema,
	beforeId: v.optional(v.string()),
	afterId: v.optional(v.string())
});

/** beforeId = 移動後に直前に来る課題、afterId = 直後に来る課題（同じ列のもの）。 */
/** 列内の課題を listBoard と同じ順序（position, number）で振り直す。 */
async function rebalanceColumn(db: DB, projectId: string, status: Status): Promise<void> {
	const rows = await db
		.select({ id: issue.id })
		.from(issue)
		.where(and(eq(issue.projectId, projectId), eq(issue.status, status)))
		.orderBy(asc(issue.position), asc(issue.number));
	if (rows.length === 0) return;
	const keys = generateNKeysBetween(null, null, rows.length);
	const [first, ...rest] = rows.map((r, i) =>
		db.update(issue).set({ position: keys[i] }).where(eq(issue.id, r.id))
	);
	await db.batch([first, ...rest]);
}

export async function moveIssue(ctx: AppContext, key: string, input: unknown): Promise<void> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const data = parse(MoveInput, input);
	const [cur] = await ctx.db
		.select()
		.from(issue)
		.where(and(eq(issue.id, data.issueId), eq(issue.projectId, p.id)));
	if (!cur) throw new AppError('not_found', '課題が見つかりません');
	assertNotDeleted(cur);
	authorize(ctx.actor, 'issue:changeStatus', { reporterId: cur.reporterId });
	const statusChanged = data.status !== cur.status;
	const fields = statusChanged ? await loadFieldSets(ctx.db, p.id) : null;
	if (fields) assertStatusIn(fields, data.status);

	const neighbor = async (id: string | null | undefined): Promise<string | null> => {
		if (!id) return null;
		const [n] = await ctx.db
			.select({ position: issue.position, status: issue.status })
			.from(issue)
			.where(and(eq(issue.id, id), eq(issue.projectId, p.id), isNull(issue.deletedAt)));
		if (!n || n.status !== data.status || id === cur.id) throw new AppError('validation', STALE);
		return n.position;
	};
	const beforeId = emptyToNull(data.beforeId);
	const afterId = emptyToNull(data.afterId);
	let lo = await neighbor(beforeId);
	let hi = await neighbor(afterId);
	if (lo !== null && hi !== null) {
		if (lo > hi) throw new AppError('validation', STALE);
		if (lo === hi) {
			// 同時起票などで位置が重複した列は、振り直してから間に入れる
			await rebalanceColumn(ctx.db, p.id, data.status);
			lo = await neighbor(beforeId);
			hi = await neighbor(afterId);
			if (lo === null || hi === null || lo >= hi) throw new AppError('validation', STALE);
		}
	}

	let position: string;
	try {
		position = generateKeyBetween(lo, hi);
	} catch {
		throw new AppError('validation', STALE);
	}
	const patch = { status: data.status, position };
	await applyPatch(ctx, cur, patch, fields ? describeChanges(fields, cur, patch) : []);
	if (statusChanged) {
		await notify(ctx, {
			project: p,
			issue: { id: cur.id, number: cur.number, title: cur.title },
			events: [{ kind: 'status_changed', from: cur.status, to: data.status }]
		});
	}
}

/**
 * 削除は論理削除。一覧からは消え、削除履歴から内容を閲覧できる（添付も残す）。
 * 子課題は残し、親子関係だけ外す
 */
export async function deleteIssue(ctx: AppContext, key: string, number: number): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	assertNotDeleted(cur);
	authorize(ctx.actor, 'issue:delete');
	await ctx.db.batch([
		ctx.db
			.update(issue)
			.set({ deletedAt: new Date(), deletedBy: ctx.actor.id })
			.where(eq(issue.id, cur.id)),
		ctx.db.update(issue).set({ parentId: null }).where(eq(issue.parentId, cur.id))
	]);
}
