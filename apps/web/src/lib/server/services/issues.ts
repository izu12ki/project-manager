import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/labels';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { attachment, category, issue, milestone, project, user } from '../db/schema';
import { AppError } from '../errors';
import { emptyToNull, parse } from '../validation';
import { linkAttachments } from './attachment-links';
import { assertCategoryOf, assertMilestoneOf } from './issue-fields';
import {
	assertAssignable,
	assertWritable,
	forgetProject,
	requireProject,
	type ProjectRow
} from './projects';

const STALE = '並び順が古くなっています。画面を再読み込みしてください';

const TitleSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'タイトルを入力してください'),
	v.maxLength(200, 'タイトルは200文字以内で入力してください')
);
const DescriptionSchema = v.pipe(
	v.string(),
	v.maxLength(50_000, '説明は50,000文字以内で入力してください')
);
const DateOrEmpty = v.union(
	[v.literal(''), v.pipe(v.string(), v.isoDate())],
	'日付の形式が正しくありません'
);

/** assigneeId / categoryId / milestoneId は 'none' で未設定のものに絞る。q はタイトルか番号の部分一致。 */
export interface IssueFilters {
	status?: Status;
	assigneeId?: string;
	priority?: Priority;
	categoryId?: string;
	milestoneId?: string;
	q?: string;
}

const assignee = alias(user, 'assignee');
const reporter = alias(user, 'reporter');

const listColumns = {
	id: issue.id,
	number: issue.number,
	title: issue.title,
	status: issue.status,
	priority: issue.priority,
	dueDate: issue.dueDate,
	position: issue.position,
	assigneeId: issue.assigneeId,
	assigneeName: assignee.name,
	categoryId: issue.categoryId,
	categoryName: category.name,
	milestoneId: issue.milestoneId,
	milestoneName: milestone.name,
	reporterId: issue.reporterId,
	updatedAt: issue.updatedAt
};

export type IssueListItem = Awaited<ReturnType<typeof selectIssues>>[number];

function selectIssues(db: DB, where: SQL | undefined, order: SQL[]) {
	return db
		.select(listColumns)
		.from(issue)
		.leftJoin(assignee, eq(issue.assigneeId, assignee.id))
		.leftJoin(category, eq(issue.categoryId, category.id))
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.where(where)
		.orderBy(...order);
}

function optionCond(
	col: typeof issue.assigneeId | typeof issue.categoryId | typeof issue.milestoneId,
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
		filters.status ? eq(issue.status, filters.status) : undefined,
		filters.priority ? eq(issue.priority, filters.priority) : undefined,
		optionCond(issue.assigneeId, filters.assigneeId),
		optionCond(issue.categoryId, filters.categoryId),
		optionCond(issue.milestoneId, filters.milestoneId),
		keywordCond(p.key, filters.q)
	);
}

export async function listIssues(ctx: AppContext, key: string, filters: IssueFilters = {}) {
	const p = await requireProject(ctx, key);
	return selectIssues(ctx.db, filterConds(p, filters), [desc(issue.number)]);
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
		.where(and(inArray(issue.projectId, projectIds), ne(issue.status, 'done')))
		.groupBy(issue.projectId);
	return Object.fromEntries(rows.map((r) => [r.projectId, r.n]));
}

/** 絞り込んだ場合も、カード間の並び順は全体の position を保つ。 */
export async function listBoard(
	ctx: AppContext,
	key: string,
	filters: Omit<IssueFilters, 'status'> = {}
): Promise<Record<Status, IssueListItem[]>> {
	const p = await requireProject(ctx, key);
	const rows = await selectIssues(ctx.db, filterConds(p, { ...filters, status: undefined }), [
		asc(issue.position),
		asc(issue.number)
	]);
	const board = Object.fromEntries(STATUSES.map((s) => [s, [] as IssueListItem[]])) as Record<
		Status,
		IssueListItem[]
	>;
	for (const r of rows) board[r.status].push(r);
	return board;
}

export async function getIssue(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	const [row] = await ctx.db
		.select({ issue, assigneeName: assignee.name, reporterName: reporter.name })
		.from(issue)
		.leftJoin(assignee, eq(issue.assigneeId, assignee.id))
		.innerJoin(reporter, eq(issue.reporterId, reporter.id))
		.where(and(eq(issue.projectId, p.id), eq(issue.number, number)));
	if (!row) throw new AppError('not_found', '課題が見つかりません');
	return {
		project: p as ProjectRow,
		issue: { ...row.issue, assigneeName: row.assigneeName, reporterName: row.reporterName }
	};
}

async function nextPosition(db: DB, projectId: string, status: Status): Promise<string> {
	const [row] = await db
		.select({ max: sql<string | null>`max(${issue.position})` })
		.from(issue)
		.where(and(eq(issue.projectId, projectId), eq(issue.status, status)));
	return generateKeyBetween(row?.max ?? null, null);
}

const CreateInput = v.object({
	title: TitleSchema,
	description: v.optional(DescriptionSchema, ''),
	status: v.optional(v.picklist(STATUSES), 'todo'),
	priority: v.optional(v.picklist(PRIORITIES), 'none'),
	startDate: v.optional(DateOrEmpty),
	dueDate: v.optional(DateOrEmpty),
	assigneeId: v.optional(v.string()),
	categoryId: v.optional(v.string()),
	milestoneId: v.optional(v.string())
});

function assertDateRange(start: string | null, due: string | null): void {
	if (start && due && start > due) {
		const msg = '開始日は期限日以前の日付にしてください';
		throw new AppError('validation', msg, { startDate: [msg] });
	}
}

export async function createIssue(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<{ number: number }> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	authorize(ctx.actor, 'issue:create');
	const data = parse(CreateInput, input);
	const assigneeId = emptyToNull(data.assigneeId) ?? null;
	if (assigneeId) {
		authorize(ctx.actor, 'issue:assign');
		await assertAssignable(ctx.db, p.id, assigneeId);
	}
	if (data.status !== 'todo') authorize(ctx.actor, 'issue:changeStatus', { assigneeId });
	const startDate = emptyToNull(data.startDate) ?? null;
	const dueDate = emptyToNull(data.dueDate) ?? null;
	assertDateRange(startDate, dueDate);
	const categoryId = emptyToNull(data.categoryId) ?? null;
	if (categoryId) await assertCategoryOf(ctx.db, p.id, categoryId);
	const milestoneId = emptyToNull(data.milestoneId) ?? null;
	if (milestoneId) await assertMilestoneOf(ctx.db, p.id, milestoneId);
	const id = uuidv7();
	const position = await nextPosition(ctx.db, p.id, data.status);
	await ctx.db.batch([
		ctx.db
			.update(project)
			.set({ nextIssueNumber: sql`${project.nextIssueNumber} + 1` })
			.where(eq(project.id, p.id)),
		ctx.db.insert(issue).values({
			id,
			projectId: p.id,
			number: sql`(select ${project.nextIssueNumber} - 1 from ${project} where ${project.id} = ${p.id})`,
			title: data.title,
			description: data.description,
			status: data.status,
			priority: data.priority,
			startDate,
			dueDate,
			assigneeId,
			categoryId,
			milestoneId,
			reporterId: ctx.actor.id,
			position
		})
	]);
	await linkAttachments(ctx, { projectId: p.id, issueId: id }, data.description);
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const [row] = await ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id));
	return { number: row.number };
}

const UpdateInput = v.object({
	title: v.optional(TitleSchema),
	description: v.optional(DescriptionSchema),
	priority: v.optional(v.picklist(PRIORITIES)),
	startDate: v.optional(DateOrEmpty),
	dueDate: v.optional(DateOrEmpty),
	status: v.optional(v.picklist(STATUSES)),
	assigneeId: v.optional(v.string()),
	categoryId: v.optional(v.string()),
	milestoneId: v.optional(v.string())
});

/** 未送信（undefined）の項目は変更しない。値が変わった項目だけ権限を確認する。 */
export async function updateIssue(
	ctx: AppContext,
	key: string,
	number: number,
	input: unknown
): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	const data = parse(UpdateInput, input);
	const res = { reporterId: cur.reporterId, assigneeId: cur.assigneeId };
	const patch: Partial<typeof issue.$inferInsert> = {};

	const startDate = emptyToNull(data.startDate);
	const dueDate = emptyToNull(data.dueDate);
	const categoryId = emptyToNull(data.categoryId);
	const milestoneId = emptyToNull(data.milestoneId);
	if (data.title !== undefined && data.title !== cur.title) patch.title = data.title;
	if (data.description !== undefined && data.description !== cur.description)
		patch.description = data.description;
	if (data.priority !== undefined && data.priority !== cur.priority) patch.priority = data.priority;
	if (startDate !== undefined && startDate !== cur.startDate) patch.startDate = startDate;
	if (dueDate !== undefined && dueDate !== cur.dueDate) patch.dueDate = dueDate;
	if (categoryId !== undefined && categoryId !== cur.categoryId) patch.categoryId = categoryId;
	if (milestoneId !== undefined && milestoneId !== cur.milestoneId) patch.milestoneId = milestoneId;
	if (Object.keys(patch).length > 0) authorize(ctx.actor, 'issue:edit', res);
	if (patch.startDate !== undefined || patch.dueDate !== undefined) {
		assertDateRange(
			patch.startDate !== undefined ? patch.startDate : cur.startDate,
			patch.dueDate !== undefined ? patch.dueDate : cur.dueDate
		);
	}
	if (patch.categoryId) await assertCategoryOf(ctx.db, p.id, patch.categoryId);
	if (patch.milestoneId) await assertMilestoneOf(ctx.db, p.id, patch.milestoneId);

	if (data.status !== undefined && data.status !== cur.status) {
		authorize(ctx.actor, 'issue:changeStatus', res);
		patch.status = data.status;
		patch.position = await nextPosition(ctx.db, p.id, data.status);
	}

	const assigneeId = emptyToNull(data.assigneeId);
	if (assigneeId !== undefined && assigneeId !== cur.assigneeId) {
		authorize(ctx.actor, 'issue:assign', res);
		if (assigneeId) await assertAssignable(ctx.db, p.id, assigneeId);
		patch.assigneeId = assigneeId;
	}

	if (Object.keys(patch).length === 0) return;
	await ctx.db.update(issue).set(patch).where(eq(issue.id, cur.id));
	if (patch.description !== undefined) {
		await linkAttachments(ctx, { projectId: p.id, issueId: cur.id }, patch.description);
	}
}

const MoveInput = v.object({
	issueId: v.string(),
	status: v.picklist(STATUSES),
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
	authorize(ctx.actor, 'issue:changeStatus', {
		reporterId: cur.reporterId,
		assigneeId: cur.assigneeId
	});

	const neighbor = async (id: string | null | undefined): Promise<string | null> => {
		if (!id) return null;
		const [n] = await ctx.db
			.select({ position: issue.position, status: issue.status })
			.from(issue)
			.where(and(eq(issue.id, id), eq(issue.projectId, p.id)));
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
	await ctx.db.update(issue).set({ status: data.status, position }).where(eq(issue.id, cur.id));
}

export async function deleteIssue(ctx: AppContext, key: string, number: number): Promise<void> {
	const { project: p, issue: cur } = await getIssue(ctx, key, number);
	assertWritable(p);
	authorize(ctx.actor, 'issue:delete');
	const files = await ctx.db
		.select({ r2Key: attachment.r2Key })
		.from(attachment)
		.where(eq(attachment.issueId, cur.id));
	// 添付の行は課題の削除で連鎖削除される
	await ctx.db.delete(issue).where(eq(issue.id, cur.id));
	if (files.length > 0) {
		ctx.waitUntil(
			ctx.bucket
				.delete(files.map((f) => f.r2Key))
				.catch((e) => console.error('attachment delete failed', e))
		);
	}
}
