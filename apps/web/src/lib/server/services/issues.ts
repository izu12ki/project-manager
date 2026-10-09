import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/labels';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { issue, project, user } from '../db/schema';
import { AppError } from '../errors';
import { emptyToNull, parse } from '../validation';
import { assertAssignable, assertWritable, requireProject, type ProjectRow } from './projects';

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

export interface IssueFilters {
	status?: Status;
	assigneeId?: string;
	priority?: Priority;
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
	reporterId: issue.reporterId,
	updatedAt: issue.updatedAt
};

export type IssueListItem = Awaited<ReturnType<typeof selectIssues>>[number];

function selectIssues(db: DB, where: SQL | undefined, order: SQL[]) {
	return db
		.select(listColumns)
		.from(issue)
		.leftJoin(assignee, eq(issue.assigneeId, assignee.id))
		.where(where)
		.orderBy(...order);
}

export async function listIssues(ctx: AppContext, key: string, filters: IssueFilters = {}) {
	const p = await requireProject(ctx, key);
	const conds: SQL[] = [eq(issue.projectId, p.id)];
	if (filters.status) conds.push(eq(issue.status, filters.status));
	if (filters.priority) conds.push(eq(issue.priority, filters.priority));
	if (filters.assigneeId === 'none') conds.push(isNull(issue.assigneeId));
	else if (filters.assigneeId) conds.push(eq(issue.assigneeId, filters.assigneeId));
	return selectIssues(ctx.db, and(...conds), [desc(issue.number)]);
}

export async function listBoard(
	ctx: AppContext,
	key: string
): Promise<Record<Status, IssueListItem[]>> {
	const p = await requireProject(ctx, key);
	const rows = await selectIssues(ctx.db, eq(issue.projectId, p.id), [
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
	priority: v.optional(v.picklist(PRIORITIES), 'none'),
	dueDate: v.optional(DateOrEmpty),
	assigneeId: v.optional(v.string())
});

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
	const id = uuidv7();
	const position = await nextPosition(ctx.db, p.id, 'todo');
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
			priority: data.priority,
			dueDate: emptyToNull(data.dueDate) ?? null,
			assigneeId,
			reporterId: ctx.actor.id,
			position
		})
	]);
	const [row] = await ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id));
	return { number: row.number };
}

const UpdateInput = v.object({
	title: v.optional(TitleSchema),
	description: v.optional(DescriptionSchema),
	priority: v.optional(v.picklist(PRIORITIES)),
	dueDate: v.optional(DateOrEmpty),
	status: v.optional(v.picklist(STATUSES)),
	assigneeId: v.optional(v.string())
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

	const dueDate = emptyToNull(data.dueDate);
	if (data.title !== undefined && data.title !== cur.title) patch.title = data.title;
	if (data.description !== undefined && data.description !== cur.description)
		patch.description = data.description;
	if (data.priority !== undefined && data.priority !== cur.priority) patch.priority = data.priority;
	if (dueDate !== undefined && dueDate !== cur.dueDate) patch.dueDate = dueDate;
	if (Object.keys(patch).length > 0) authorize(ctx.actor, 'issue:edit', res);

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
	await ctx.db.delete(issue).where(eq(issue.id, cur.id));
}
