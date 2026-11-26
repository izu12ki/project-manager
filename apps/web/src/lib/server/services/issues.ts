import {
	and,
	asc,
	desc,
	eq,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
	type Placeholder,
	type SQL,
	type SQLWrapper
} from 'drizzle-orm';
import { inList } from '../db/limits';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import {
	DONE_STATUS,
	INITIAL_STATUS,
	type ColorName,
	type IssueChangeItem,
	type Priority,
	type Status,
	type StatusDef
} from '#lib/labels.ts';
import { DEFAULT_ISSUE_SORT, type IssueSort } from '#lib/issue-sort.ts';
import { cachedRead } from '../db/cached-read';
import { authorize, can } from '../authz';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppContext } from '../context';
import type { DB } from '../db';
import {
	category,
	comment,
	issue,
	issueChange,
	issueType,
	milestone,
	project,
	user
} from '../db/schema';
import { AppError } from '../errors';
import { notify } from '../notifications';
import { emptyToNull, parse } from '../validation';
import { linkAttachmentsQuery } from './attachment-links';
import {
	categoriesQuery,
	listStatusesOf,
	milestonesQuery,
	statusesQuery,
	type CategoryRow,
	type MilestoneRow
} from './issue-fields';
import {
	StatusSchema,
	assertStatusIn,
	categoryIdsValue,
	createEventsOf,
	describeChanges,
	loadCreateRows,
	loadFormerAssigneeNames,
	loadUpdateRows,
	prepareCreate,
	preparePatch,
	statusFieldSets,
	type IssuePatch,
	type IssueRow,
	updateEventsOf,
	withCategoryGuard
} from './issue-input';
import {
	byProjectId,
	cachedByKey,
	checkProjectAccess,
	ofProject,
	projectAccessRead,
	type ProjectCond
} from './project-access';
import {
	assertWritable,
	assignableUsersQuery,
	forgetProject,
	requireProject,
	type ProjectRow
} from './projects';

const STALE = '並び順が古くなっています。画面を再読み込みしてください';

/**
 * status の 'open' は完了以外（タイムラインの絞り込みと同じ値）。
 * assigneeId / categoryId はその人・カテゴリーを含む課題、'none' は 1 つもない課題。
 * typeId / milestoneId は 'none' で未設定のものに絞る。q はタイトル・本文・コメントの部分一致か番号の一致。
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

/**
 * 担当者の名前（assigneeIds の順。存在しない ID は除く）とカテゴリーの名前（プロジェクトのカテゴリー順。
 * 削除したものは除く）を JSON の配列で同じ文に入れる。別の問い合わせにすると D1 への往復が増えるため
 */
const assigneesJson = sql<string>`(select json_group_array(json_object('id', ${user.id}, 'name', ${user.name}) order by j.key)
	from json_each(${issue.assigneeIds}) as j join ${user} on ${user.id} = j.value)`;
const categoriesJson = sql<string>`(select json_group_array(json_object('id', ${category.id}, 'name', ${category.name}) order by ${category.createdAt}, ${category.id})
	from ${category} where ${category.id} in (select value from json_each(${issue.categoryIds})))`;

/**
 * 一覧の画面用の、担当者・カテゴリーの名前だけの配列（並び順は assigneesJson・categoriesJson と同じ）。
 * 画面は ID を使わないので、ID の分だけ画面へ渡すデータを小さくする
 */
const assigneeNamesJson = sql<string>`(select json_group_array(${user.name} order by j.key)
	from json_each(${issue.assigneeIds}) as j join ${user} on ${user.id} = j.value)`;
const categoryNamesJson = sql<string>`(select json_group_array(${category.name} order by ${category.createdAt}, ${category.id})
	from ${category} where ${category.id} in (select value from json_each(${issue.categoryIds})))`;

// batch に入れても列名が重ならないよう、join した表の列と式には別名を付ける（D1 の batch は同じ名前の列をまとめてしまう）
const shownColumns = {
	number: issue.number,
	title: issue.title,
	typeName: sql<string | null>`${issueType.name}`.as('type_name'),
	typeColor: sql<ColorName | null>`${issueType.color}`.as('type_color'),
	status: issue.status,
	priority: issue.priority,
	startDate: issue.startDate,
	dueDate: issue.dueDate,
	parentNumber: sql<number | null>`${parent.number}`.as('parent_number'),
	milestoneName: sql<string | null>`${milestone.name}`.as('milestone_name'),
	createdAt: issue.createdAt,
	updatedAt: issue.updatedAt
};
/**
 * 一覧の画面（課題一覧・自分の課題）で表示する列。表示しない列も読むと、D1 の結果の解釈・
 * JSON の列の変換・画面へ渡すデータの書き出しが行数の分だけ増えるので、表示に要る列だけにする。
 * 課題の ID も読まない。カテゴリーは課題一覧だけが表示するので、issueListViewQuery で足す
 */
const listViewColumns = {
	...shownColumns,
	assigneesJson: assigneeNamesJson.as('assignees_json')
};
/** ボード・タイムライン・API の一覧の列。並び順や ID で課題を動かし、絞り込むので、表示しない列も要る */
const listColumns = {
	id: issue.id,
	...shownColumns,
	assigneesJson: assigneesJson.as('assignees_json'),
	categoriesJson: categoriesJson.as('categories_json'),
	typeId: issue.typeId,
	resolution: issue.resolution,
	position: issue.position,
	assigneeIds: issue.assigneeIds,
	parentId: issue.parentId,
	categoryIds: issue.categoryIds,
	milestoneId: issue.milestoneId,
	reporterId: issue.reporterId
};

type IssueListRow = Awaited<ReturnType<typeof issueListQuery>>[number];
/** ボード・タイムライン・API の一覧（issueListQuery）の 1 件 */
export type IssueListItem = ReturnType<typeof toIssueListItems<IssueListRow>>[number];
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

/** 課題の一覧の select。batch にも入れられる。結果は toIssueListItems で直す */
export function issueListQuery(db: DB, where: SQL | undefined, order: SQL[]) {
	return selectIssueList(db, {})
		.where(where)
		.orderBy(...order);
}

/**
 * 課題一覧の画面の select。issueListQuery より列が少ない（listViewColumns とカテゴリーの名前）。
 * 結果は toIssueListViewItems と、categoriesJson の JSON.parse で直す
 */
export function issueListViewQuery(db: DB, where: SQL | undefined, order: SQL[]) {
	return selectIssueListView(db, { categoriesJson: categoryNamesJson.as('categories_json') })
		.where(where)
		.orderBy(...order);
}

type Columns = Record<string, SQL.Aliased | SQLiteColumn>;

/**
 * issueListQuery の列に extra の列を足した select（join まで）。プロジェクトをまたぐ一覧で、
 * プロジェクトやステータスの列を足すのに使う。extra の式にも別名を付けること
 */
export function selectIssueList<T extends Columns>(db: DB, extra: T) {
	return db
		.select({ ...listColumns, ...extra })
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.leftJoin(issueType, eq(issue.typeId, issueType.id))
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.$dynamic();
}

/**
 * selectIssueList の、一覧の画面で表示する列（listViewColumns）だけのもの。join は selectIssueList と同じ
 * （select に列の型引数をそのまま渡すと Drizzle の型が join を解決できないので、関数を分けずに書く）
 */
export function selectIssueListView<T extends Columns>(db: DB, extra: T) {
	return db
		.select({ ...listViewColumns, ...extra })
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.leftJoin(issueType, eq(issue.typeId, issueType.id))
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.$dynamic();
}

/** issueListQuery（selectIssueList）の行の JSON の列を assignees・categories に直す */
export function toIssueListItems<R extends { assigneesJson: string; categoriesJson: string }>(
	rows: R[]
) {
	return rows.map(({ assigneesJson, categoriesJson, ...r }) => ({
		...r,
		assignees: JSON.parse(assigneesJson) as AssigneeRef[],
		categories: JSON.parse(categoriesJson) as CategoryRef[]
	}));
}

/**
 * selectIssueListView の行の担当者の JSON の列を assigneeNames に直す。
 * issueListViewQuery のカテゴリーの JSON の列（categoriesJson）は、課題一覧の側で直す
 */
export function toIssueListViewItems<R extends { assigneesJson: string }>(rows: R[]) {
	return rows.map(({ assigneesJson, ...r }) => ({
		...r,
		assigneeNames: JSON.parse(assigneesJson) as string[]
	}));
}

async function selectIssues(db: DB, where: SQL | undefined, order: SQL[]) {
	return toIssueListItems(await issueListQuery(db, where, order));
}

/** ID の配列の列で絞る。'none' は空配列、それ以外はその ID を含む課題 */
export function idsCond(
	col: typeof issue.assigneeIds | typeof issue.categoryIds,
	value: string | undefined
): SQL | undefined {
	if (!value) return undefined;
	if (value === 'none') return sql`json_array_length(${col}) = 0`;
	return sql`exists (select 1 from json_each(${col}) where value = ${value})`;
}

/** ステータスで絞る。'open' は完了以外 */
export function statusCond(value: string | undefined): SQL | undefined {
	if (!value) return undefined;
	return value === 'open' ? ne(issue.status, DONE_STATUS) : eq(issue.status, value);
}

function optionCond(
	col: typeof issue.typeId | typeof issue.milestoneId,
	value: string | undefined
): SQL | undefined {
	if (!value) return undefined;
	return value === 'none' ? isNull(col) : eq(col, value);
}

/**
 * タイトル・本文・コメントの部分一致（Backlog のキーワード検索と同じ範囲）。
 * 「ACME-12」「#12」「12」は番号の一致としても扱う。
 * 「OLD-12」のような課題キーの形は、Backlog から取り込んだ課題の元のキーとも比べる
 */
function keywordCond(projectKey: string, q: string | undefined): SQL | undefined {
	const kw = q?.trim();
	if (!kw) return undefined;
	// LIKE は使わない（D1 は LIKE のパターンが 50 バイトまでで、日本語 17 文字ほどで失敗する）。
	// instr なら長さの制限がなく、% や _ も文字のまま比べる。lower は LIKE と同じく英字だけを小文字にする
	const has = (col: SQLWrapper) => sql`instr(lower(${col}), lower(${kw})) > 0`;
	const conds = [
		has(issue.title),
		has(issue.description),
		// コメントは課題ごとの索引（comment_issue_idx）で引く。削除したコメントは行ごと消えるので当たらない
		sql`exists (select 1 from ${comment} where ${comment.issueId} = ${issue.id} and ${has(comment.body)})`
	];
	// キーは URL から来ることがある（一覧の batch はプロジェクトの行を待たない）。正規表現の記号は文字として扱う
	const key = projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const m = kw.match(new RegExp(`^(?:${key}-|#)?(\\d{1,9})$`, 'i'));
	if (m) conds.push(eq(issue.number, Number(m[1])));
	if (/^[a-z][a-z0-9_]*-\d+$/i.test(kw)) conds.push(eq(issue.backlogKey, kw.toUpperCase()));
	return or(...conds);
}

/** 一覧の絞り込み。プロジェクトは of で絞る（ID でもキーの副問い合わせでもよい）。キーは「ACME-12」の番号検索に使う */
export function filterConds(
	projectKey: string,
	of: ProjectCond,
	filters: IssueFilters
): SQL | undefined {
	return and(
		of(issue.projectId),
		isNull(issue.deletedAt),
		statusCond(filters.status),
		filters.priority ? eq(issue.priority, filters.priority) : undefined,
		idsCond(issue.assigneeIds, filters.assigneeId),
		idsCond(issue.categoryIds, filters.categoryId),
		optionCond(issue.typeId, filters.typeId),
		optionCond(issue.milestoneId, filters.milestoneId),
		keywordCond(projectKey, filters.q)
	);
}

/** 並べ替えの ORDER BY。日付が空の課題は、どちらの向きでも末尾に置く。同じ値の中はキーの降順 */
export function sortOrder(sort: IssueSort): SQL[] {
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
	return selectIssues(ctx.db, filterConds(p.key, byProjectId(p.id), filters), sortOrder(sort));
}

/**
 * カンバンの列に出すカードの上限。完了の列は最近更新したもの、それ以外の列は上（position の小さい方）から。
 * Backlog から移した数千件のプロジェクトでも、1 回の表示の CPU 時間が増え続けないようにする
 */
export const BOARD_LIMIT = { done: 30, other: 50 } as const;

/**
 * カンバン（remote query の getBoard）に要るもの。1 回の batch（D1 への 1 往復）で引く。
 * 列はプロジェクトのステータス順。絞り込んだ場合も、カード間の並び順は全体の position を保つ。
 * 各列は BOARD_LIMIT までに絞り、totals に列ごとの課題の数（絞り込んだ後、上限で切る前）を返す
 */
export async function listBoard(
	ctx: AppContext,
	key: string,
	filters: Omit<IssueFilters, 'status'> = {}
): Promise<{
	statuses: StatusDef[];
	columns: Record<Status, BoardCard[]>;
	totals: Record<Status, number>;
	milestones: MilestoneRow[];
}> {
	const { db } = ctx;
	const filtered = Object.values(filters).some((v) => v !== undefined);
	const where = filtered
		? filterConds(key, ofProject(db, key), { ...filters, status: undefined })
		: undefined;
	const [access, statuses, rows, counts, milestones] = await ctx.readBatch([
		// アクセスとステータスはレイアウトも引く（同じ文は 1 回だけ送る。db/read-batch.ts）
		projectAccessRead(ctx, key),
		cachedByKey(statusesQuery)(db, key),
		filtered ? boardCardsQuery(db, where) : unfilteredBoardCards(db, key),
		filtered ? boardCountsQuery(db, where) : unfilteredBoardCounts(db, key),
		cachedByKey(milestonesQuery)(db, key)
	]);
	checkProjectAccess(ctx, access);
	const columns: Record<Status, BoardCard[]> = Object.fromEntries(
		statuses.map((s) => [s.key, [] as BoardCard[]])
	);
	const totals: Record<Status, number> = Object.fromEntries(statuses.map((s) => [s.key, 0]));
	// 定義が消えたステータスの課題は初期ステータスの列に出す
	const columnOf = (status: Status) => (status in columns ? status : INITIAL_STATUS);
	for (const { status, assigneesJson, categoriesJson, ...card } of rows) {
		columns[columnOf(status)]?.push({
			...card,
			assigneeNames: JSON.parse(assigneesJson) as string[],
			categoryNames: JSON.parse(categoriesJson) as string[]
		});
	}
	for (const { status, n } of counts) {
		const c = columnOf(status);
		if (c in totals) totals[c] += n;
	}
	return { statuses, columns, totals, milestones };
}

/**
 * カンバンのカード（列ごとに BOARD_LIMIT まで）。カードに出すものと、列に分けるステータス・移動に使う ID だけを読む。
 * カードの数（数百）だけ、D1 の結果の解釈・画面へ渡すデータの書き出しが増えるため（担当者・カテゴリーも名前だけ）
 */
function boardCardsQuery(db: DB, where: SQL | undefined) {
	// 列ごとに順位を付けて上限までを残す。副問い合わせの "issue" は内側の from を指す
	const shown = sql`${issue.id} in (
		select id from (
			select ${issue.id} as id, ${issue.status} as status, row_number() over (
				partition by ${issue.status}
				order by case when ${issue.status} = ${DONE_STATUS} then -${issue.updatedAt} else 0 end,
					${issue.position}, ${issue.number}
			) as rn
			from ${issue} where ${where ?? sql`1 = 1`}
		) where rn <= case when status = ${DONE_STATUS} then ${BOARD_LIMIT.done} else ${BOARD_LIMIT.other} end
	)`;
	return db
		.select({
			id: issue.id,
			number: issue.number,
			title: issue.title,
			typeName: shownColumns.typeName,
			typeColor: shownColumns.typeColor,
			status: issue.status,
			priority: issue.priority,
			dueDate: issue.dueDate,
			parentNumber: shownColumns.parentNumber,
			milestoneName: shownColumns.milestoneName,
			assigneesJson: assigneeNamesJson.as('assignees_json'),
			categoriesJson: categoryNamesJson.as('categories_json')
		})
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.leftJoin(issueType, eq(issue.typeId, issueType.id))
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.where(and(where, shown))
		.orderBy(asc(issue.position), asc(issue.number));
}

/** 列ごとの課題の数（絞り込んだ後、BOARD_LIMIT で切る前） */
function boardCountsQuery(db: DB, where: SQL | undefined) {
	return db
		.select({ status: issue.status, n: sql<number>`count(*)`.as('board_count') })
		.from(issue)
		.where(where)
		.groupBy(issue.status);
}

// 絞り込みのないカンバン（開いたとき）は、組み立てを使い回す（db/cached-read.ts）。絞り込むと値によって文の形が変わる
const unfilteredBoardCards = cachedByKey((db, of) => boardCardsQuery(db, filterConds('', of, {})));
const unfilteredBoardCounts = cachedByKey((db, of) =>
	boardCountsQuery(db, filterConds('', of, {}))
);

type BoardCardRow = Awaited<ReturnType<typeof boardCardsQuery>>[number];
/** カンバンのカード 1 枚 */
export type BoardCard = Omit<BoardCardRow, 'status' | 'assigneesJson' | 'categoriesJson'> & {
	assigneeNames: string[];
	categoryNames: string[];
};

/** タイムラインに行を出す課題（日付のある課題）の数。表示の開始日に近いものから */
export const SCHEDULED_LIMIT = 300;
/** タイムラインの「未スケジュール」に出す課題の数。新しいものから */
export const UNSCHEDULED_LIMIT = 50;

export interface TimelineView {
	/**
	 * 表示の開始日（'YYYY-MM-DD'）。完了した課題のうち、この日より前に終わったもの（期限、なければ開始日が前）は返さない。
	 * 省略すると完了した課題もすべて返す
	 */
	from?: string;
	filters?: Pick<IssueFilters, 'status' | 'assigneeId' | 'categoryId' | 'milestoneId'>;
}

/**
 * タイムライン（remote query の getTimeline）に要るもの。1 回の batch（D1 への 1 往復）で引く。
 * 日付のある課題（完了したものは view.from 以降に終わるものだけ。view.from に近い順に SCHEDULED_LIMIT 件まで）と、
 * 日付がなく未完了の課題（新しい順に UNSCHEDULED_LIMIT 件まで）を、絞り込んで返す。*Total は上限で切る前の数。
 * 未完了の課題は表示範囲の外でも返す（範囲外の課題にも行を出すため）。並べ替え・グループ化はクライアント側で行う。
 * Backlog から移した数千件のプロジェクトでは、課題をすべて返すと 1 回の表示の CPU 時間が 100ms を超える
 */
export async function listTimeline(
	ctx: AppContext,
	key: string,
	view: TimelineView = {}
): Promise<{
	scheduled: TimelineItem[];
	scheduledTotal: number;
	unscheduled: TimelineItem[];
	unscheduledTotal: number;
	milestones: MilestoneRow[];
	categories: CategoryRow[];
	assignees: Awaited<ReturnType<typeof assignableUsersQuery>>;
}> {
	const { db } = ctx;
	const filters = view.filters ?? {};
	const filtered = Object.values(filters).some((v) => v !== undefined);
	// 絞り込みがなく開始日のあるとき（開いたとき）は、組み立てを使い回す（db/cached-read.ts）
	const q =
		filtered || view.from === undefined
			? timelineQueries(db, filterConds(key, ofProject(db, key), filters), view.from)
			: {
					scheduled: unfilteredTimeline.scheduled(db, { key, from: view.from }),
					scheduledTotal: unfilteredTimeline.scheduledTotal(db, { key, from: view.from }),
					unscheduled: unfilteredTimeline.unscheduled(db, { key }),
					unscheduledTotal: unfilteredTimeline.unscheduledTotal(db, { key })
				};
	const [
		access,
		scheduledRows,
		[{ scheduledTotal }],
		unscheduledRows,
		[{ unscheduledTotal }],
		milestones,
		categories,
		assignees
	] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		q.scheduled,
		q.scheduledTotal,
		q.unscheduled,
		q.unscheduledTotal,
		cachedByKey(milestonesQuery)(db, key),
		cachedByKey(categoriesQuery)(db, key),
		cachedByKey(assignableUsersQuery)(db, key)
	]);
	const p = checkProjectAccess(ctx, access);
	const toItems = (rows: TimelineRow[]): TimelineItem[] =>
		rows.map(({ assigneesJson, reporterId, ...r }) => ({
			...r,
			assignees: JSON.parse(assigneesJson) as AssigneeRef[],
			canEdit: !p.archivedAt && can(ctx.actor, 'issue:edit', { reporterId })
		}));
	return {
		scheduled: toItems(scheduledRows),
		scheduledTotal,
		unscheduled: toItems(unscheduledRows),
		unscheduledTotal,
		milestones,
		categories,
		assignees
	};
}

/**
 * タイムラインの文（日付のある課題とその数、日付のない未完了の課題とその数）。from は表示の開始日
 * （cachedRead のプレースホルダーでもよい）。省略すると完了した課題もすべて対象にし、番号順に上限まで
 */
function timelineQueries(db: DB, where: SQL | undefined, from: string | Placeholder | undefined) {
	const scheduledWhere = and(
		where,
		or(isNotNull(issue.startDate), isNotNull(issue.dueDate)),
		from === undefined
			? undefined
			: or(
					ne(issue.status, DONE_STATUS),
					sql`coalesce(${issue.dueDate}, ${issue.startDate}) >= ${from}`
				)
	);
	// 開始日から期限までの間と from との隔たり（日数）。間に from を含めば 0。from がなければ番号順
	const distance =
		from === undefined
			? sql`${issue.number}`
			: sql`max(0, julianday(coalesce(${issue.startDate}, ${issue.dueDate})) - julianday(${from}),
			julianday(${from}) - julianday(coalesce(${issue.dueDate}, ${issue.startDate})))`;
	const scheduledShown = sql`${issue.id} in (
		select ${issue.id} from ${issue} where ${scheduledWhere ?? sql`1 = 1`}
		order by ${distance}, ${issue.number} limit ${SCHEDULED_LIMIT}
	)`;
	const unscheduledWhere = and(
		where,
		isNull(issue.startDate),
		isNull(issue.dueDate),
		ne(issue.status, DONE_STATUS)
	);
	return {
		scheduled: timelineRowsQuery(db, and(scheduledWhere, scheduledShown)).orderBy(
			asc(issue.number)
		),
		scheduledTotal: db
			.select({ scheduledTotal: sql<number>`count(*)`.as('scheduled_total') })
			.from(issue)
			.where(scheduledWhere),
		unscheduled: timelineRowsQuery(db, unscheduledWhere)
			.orderBy(desc(issue.number))
			.limit(UNSCHEDULED_LIMIT),
		unscheduledTotal: db
			.select({ unscheduledTotal: sql<number>`count(*)`.as('unscheduled_total') })
			.from(issue)
			.where(unscheduledWhere)
	};
}

/**
 * タイムラインの行の列。行に出すものと、グループ分け（担当者・マイルストーン）・編集の可否に使うものだけを読む。
 * 行の数（数百）だけ、D1 の結果の解釈・画面へ渡すデータの書き出しが増えるため
 */
function timelineRowsQuery(db: DB, where: SQL | undefined) {
	return db
		.select({
			id: issue.id,
			number: issue.number,
			title: issue.title,
			status: issue.status,
			startDate: issue.startDate,
			dueDate: issue.dueDate,
			milestoneId: issue.milestoneId,
			milestoneName: shownColumns.milestoneName,
			assigneesJson: assigneesJson.as('assignees_json'),
			reporterId: issue.reporterId
		})
		.from(issue)
		.leftJoin(milestone, eq(issue.milestoneId, milestone.id))
		.where(where)
		.$dynamic();
}

type TimelineRow = Awaited<ReturnType<typeof timelineRowsQuery>>[number];
/** タイムラインの行 1 つ */
export type TimelineItem = Omit<TimelineRow, 'assigneesJson' | 'reporterId'> & {
	assignees: AssigneeRef[];
	canEdit: boolean;
};

// 絞り込みのないタイムライン（開いたとき）の文。開始日は日ごとに変わるのでプレースホルダーにする
const unfilteredTimelineQueries = (db: DB, p: { key: Placeholder; from?: Placeholder }) =>
	timelineQueries(db, filterConds('', ofProject(db, p.key), {}), p.from);
const unfilteredTimeline = {
	scheduled: cachedRead(['key', 'from'], (db, p) => unfilteredTimelineQueries(db, p).scheduled),
	scheduledTotal: cachedRead(
		['key', 'from'],
		(db, p) => unfilteredTimelineQueries(db, p).scheduledTotal
	),
	unscheduled: cachedRead(['key'], (db, p) => unfilteredTimelineQueries(db, p).unscheduled),
	unscheduledTotal: cachedRead(
		['key'],
		(db, p) => unfilteredTimelineQueries(db, p).unscheduledTotal
	)
};

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
 * 親課題の欄の候補に出す課題の数。番号を入力すれば、候補にない課題も親にできる。
 * 課題の多いプロジェクトで、起票の画面を開くたびに全件を読まないようにする
 */
export const PARENT_CANDIDATE_LIMIT = 100;

/**
 * 親課題の候補（子課題でない、削除していない課題を新しい順に PARENT_CANDIDATE_LIMIT 件まで）。batch にも入れられる。
 * 子課題は 1 階層までなので、子課題でない課題だけ。exceptNumber（親を設定しようとしている課題自身）は除く
 */
export function parentCandidatesQuery(db: DB, of: ProjectCond, exceptNumber?: number) {
	return db
		.select({ number: issue.number, title: issue.title })
		.from(issue)
		.where(
			and(
				of(issue.projectId),
				isNull(issue.parentId),
				isNull(issue.deletedAt),
				exceptNumber === undefined ? undefined : ne(issue.number, exceptNumber)
			)
		)
		.orderBy(desc(issue.number))
		.limit(PARENT_CANDIDATE_LIMIT);
}

/** 番号で指定した課題が親にできるなら、その番号とタイトル（なければ空の配列）。batch にも入れられる */
export function parentByNumberQuery(db: DB, of: ProjectCond, number: number) {
	return db
		.select({ number: issue.number, title: issue.title })
		.from(issue)
		.where(
			and(
				of(issue.projectId),
				eq(issue.number, number),
				isNull(issue.parentId),
				isNull(issue.deletedAt)
			)
		);
}

export async function listParentCandidates(ctx: AppContext, key: string, exceptNumber?: number) {
	const p = await requireProject(ctx, key);
	return parentCandidatesQuery(ctx.db, byProjectId(p.id), exceptNumber);
}

/** 削除した課題は閲覧だけできる */
export function assertNotDeleted(i: { deletedAt: Date | null }): void {
	if (i.deletedAt) throw new AppError('conflict', '削除された課題は変更できません');
}

/** 削除履歴（新しい順） */
/** 削除した課題（新しい順）。batch にも入れられる */
export function deletedIssuesQuery(db: DB, of: ProjectCond) {
	return db
		.select({
			number: issue.number,
			title: issue.title,
			deletedAt: issue.deletedAt,
			deletedByName: deleter.name
		})
		.from(issue)
		.leftJoin(deleter, eq(issue.deletedBy, deleter.id))
		.where(and(of(issue.projectId), isNotNull(issue.deletedAt)))
		.orderBy(desc(issue.deletedAt));
}

export async function listDeletedIssues(ctx: AppContext, key: string) {
	const p = await requireProject(ctx, key);
	return deletedIssuesQuery(ctx.db, byProjectId(p.id));
}

export async function createIssue(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<{ number: number }> {
	const { project: p, fields, tail } = await loadCreateRows(ctx, key, input);
	assertWritable(p);
	const values = prepareCreate(ctx.actor, fields, input);
	const { id } = values;
	const link = linkAttachmentsQuery(ctx, { projectId: p.id, issueId: id }, values.description);
	// 振られた番号はバッチ末尾の select で引く（往復を増やさない）
	const results = await ctx.db.batch([
		ctx.db
			.update(project)
			.set({ nextIssueNumber: sql`${project.nextIssueNumber} + 1` })
			.where(eq(project.id, p.id)),
		ctx.db.insert(issue).values({
			...values,
			categoryIds: categoryIdsValue(p.id, values.categoryIds ?? []),
			projectId: p.id,
			number: sql`(select ${project.nextIssueNumber} - 1 from ${project} where ${project.id} = ${p.id})`,
			// tail は入力のステータスの列の末尾（values.status は検証済みの同じ値）
			position: generateKeyBetween(tail, null)
		}),
		...(link ? [link] : []),
		ctx.db.select({ number: issue.number }).from(issue).where(eq(issue.id, id))
	]);
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const [row] = results[results.length - 1] as { number: number }[];
	await notify(
		ctx,
		{
			project: p,
			issue: { id, number: row.number, title: values.title },
			events: createEventsOf(values)
		},
		{
			participants: {
				reporterId: ctx.actor.id,
				assigneeIds: values.assigneeIds ?? [],
				commenterIds: []
			},
			names: fields.assignable,
			priority: values.priority ?? 'none',
			statuses: fields.statuses
		}
	);
	return { number: row.number };
}

/** 課題を更新し、同時に編集履歴を残す。also は同じ batch（1 往復・1 トランザクション）で送る書き込み */
async function applyPatch(
	ctx: AppContext,
	cur: IssueRow,
	patch: IssuePatch,
	changes: IssueChangeItem[],
	also: BatchItem<'sqlite'>[] = []
): Promise<void> {
	const update = ctx.db
		.update(issue)
		.set(withCategoryGuard(cur.projectId, patch))
		.where(eq(issue.id, cur.id));
	if (changes.length === 0 && also.length === 0) {
		await update;
		return;
	}
	await ctx.db.batch([
		update,
		...(changes.length > 0
			? [
					ctx.db
						.insert(issueChange)
						.values({ id: uuidv7(), issueId: cur.id, actorId: ctx.actor.id, changes })
				]
			: []),
		...also
	]);
}

/** 課題の ID と削除日時（コメント・添付の一覧で、課題の有無と書き込めるかを確かめる）。batch にも入れられる */
export function issueStateQuery(db: DB, of: ProjectCond, number: number) {
	return db
		.select({ id: issue.id, deletedAt: issue.deletedAt })
		.from(issue)
		.where(and(of(issue.projectId), eq(issue.number, number)));
}

/** 課題の変更履歴（古い順）。アクセス権の確認と合わせて 1 往復 */
export async function listIssueChanges(ctx: AppContext, key: string, number: number) {
	const { db } = ctx;
	const of = ofProject(db, key);
	const [access, rows] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		db
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
			.where(and(of(issue.projectId), eq(issue.number, number)))
			.orderBy(asc(issueChange.createdAt), asc(issueChange.id))
	]);
	checkProjectAccess(ctx, access);
	return rows;
}

/**
 * 未送信（undefined）の項目は変更しない。値が変わった項目だけ権限を確認する。
 * 返すのは変えた項目（何も変わらなければ空）。画面が取り直すものを絞るのに使う
 */
export async function updateIssue(
	ctx: AppContext,
	key: string,
	number: number,
	input: unknown
): Promise<(keyof IssuePatch)[]> {
	const {
		project: p,
		cur,
		fields,
		tail,
		commenterIds
	} = await loadUpdateRows(ctx, key, number, input);
	assertWritable(p);
	assertNotDeleted(cur);
	const patch = preparePatch(ctx.actor, fields, cur, input);
	const changed = Object.keys(patch) as (keyof IssuePatch)[];
	if (changed.length === 0) return changed;
	// tail は入力のステータスの列の末尾（patch.status は検証済みの同じ値）
	if (patch.status !== undefined) patch.position = generateKeyBetween(tail, null);
	const otherUsers = await loadFormerAssigneeNames(ctx.db, fields, [{ cur, patch }]);
	const link =
		patch.description === undefined
			? null
			: linkAttachmentsQuery(ctx, { projectId: p.id, issueId: cur.id }, patch.description);
	await applyPatch(
		ctx,
		cur,
		patch,
		describeChanges(fields, cur, patch, otherUsers),
		link ? [link] : []
	);
	const events = updateEventsOf(cur, patch);
	if (events.length > 0) {
		await notify(
			ctx,
			{
				project: p,
				issue: { id: cur.id, number: cur.number, title: patch.title ?? cur.title },
				events
			},
			{
				participants: {
					reporterId: cur.reporterId,
					assigneeIds: patch.assigneeIds ?? cur.assigneeIds,
					commenterIds
				},
				names: fields.assignable,
				priority: patch.priority ?? cur.priority,
				statuses: fields.statuses
			}
		);
	}
	return changed;
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
	// 検証と変更履歴にはステータスだけ要る（loadFieldSets はプロジェクトのすべての課題を読むので使わない）
	const fields = statusChanged ? statusFieldSets(await listStatusesOf(ctx.db, p.id)) : null;
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
	if (!afterId) {
		// 後ろの課題がなければ列の末尾へ。カンバンは列の一部しか出さないことがある（BOARD_LIMIT・絞り込み）ので、
		// 見えている最後の課題の直後ではなく、列のすべての課題の後に置く
		const [last] = await ctx.db
			.select({ max: sql<string | null>`max(${issue.position})` })
			.from(issue)
			.where(
				and(
					eq(issue.projectId, p.id),
					eq(issue.status, data.status),
					ne(issue.id, cur.id),
					isNull(issue.deletedAt)
				)
			);
		if (last?.max != null && (lo === null || last.max > lo)) lo = last.max;
	}
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
