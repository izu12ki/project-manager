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
	type ColorName,
	type IssueChangeItem,
	type Priority,
	type Status,
	type StatusDef
} from '#lib/labels.ts';
import {
	BOARD_COLUMN_MAX,
	BOARD_COUNT_LIMIT,
	BOARD_PAGE_SIZE,
	type BoardLimits
} from '#lib/board-limits.ts';
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
	issueAssignee,
	issueChange,
	issueStatus,
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
	/** true なら開始日・期限のどちらもない課題だけ（タイムラインに出ない課題） */
	unscheduled?: boolean;
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
	return issueConds(projectKey, filters, {
		project: of(issue.projectId),
		status: statusCond(filters.status),
		assignee: idsCond(issue.assigneeIds, filters.assigneeId)
	});
}

/**
 * 課題一覧の画面と API の一覧の絞り込み。filterConds と同じ課題に当たり、D1 が読む行を減らす形にする
 * （1 ページ分を番号などの順に読んで止める一覧より、件数を数える文で効く）。
 * - 完了以外: status <> 'done' は索引の範囲にならず、完了した課題も読む。プロジェクトの完了以外のステータスの IN にして、
 *   issue_board_idx（プロジェクト・ステータス）の範囲だけを読む（課題のステータスは必ずプロジェクトのステータスにある）
 * - 担当者: その人の課題を issue_assignee から読む。プロジェクトの条件は +project_id にして、SQLite にプロジェクトの索引を
 *   使わせない（使うとプロジェクトの課題をすべて読み、担当者を 1 件ずつ確かめる）。
 *   カンバン・タイムラインはプロジェクトの索引で並べて読むので、こちらは使わない
 */
export function listFilterConds(
	projectKey: string,
	of: ProjectCond,
	filters: IssueFilters
): SQL | undefined {
	const assigneeId =
		filters.assigneeId && filters.assigneeId !== 'none' ? filters.assigneeId : undefined;
	const status = filters.status;
	// 担当者の索引の「完了か」。ステータスで絞るときは、その側だけを読む
	const done = status === undefined ? undefined : status === DONE_STATUS;
	return issueConds(projectKey, filters, {
		project: assigneeId ? of(sql`+${issue.projectId}`) : of(issue.projectId),
		status:
			status === 'open'
				? sql`${issue.status} in (select ${issueStatus.key} from ${issueStatus}
					where ${and(of(issueStatus.projectId), ne(issueStatus.key, DONE_STATUS))})`
				: statusCond(status),
		assignee: assigneeId
			? sql`${issue.id} in (select ${issueAssignee.issueId} from ${issueAssignee}
				where ${and(
					eq(issueAssignee.userId, assigneeId),
					done === undefined ? undefined : eq(issueAssignee.done, done)
				)})`
			: idsCond(issue.assigneeIds, filters.assigneeId)
	});
}

function issueConds(
	projectKey: string,
	filters: IssueFilters,
	c: { project: SQL; status: SQL | undefined; assignee: SQL | undefined }
): SQL | undefined {
	return and(
		c.project,
		isNull(issue.deletedAt),
		c.status,
		filters.unscheduled ? and(isNull(issue.startDate), isNull(issue.dueDate)) : undefined,
		filters.priority ? eq(issue.priority, filters.priority) : undefined,
		c.assignee,
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

export { BOARD_COLUMN_MAX, BOARD_COUNT_LIMIT, BOARD_PAGE_SIZE, type BoardLimits };

/**
 * カンバン（remote query の getBoard）に要るもの。1 回の batch（D1 への 1 往復）で引く。
 * 列はプロジェクトのステータス順。完了の列は position の大きい順（最近完了にしたものが上）、それ以外は小さい順。
 * 各列は limits の数まで（既定は BOARD_PAGE_SIZE）を読み、totals に列ごとの課題の数（絞り込んだ後、上限で切る前）を返す。
 * totals は列ごとに max(読み込む数, BOARD_COUNT_LIMIT) + 1 件で数えるのをやめる。BOARD_COUNT_LIMIT を超えた列の数は
 * 正確ではないが、読み込んだ数より多ければ続きがある（ちょうどその数なら続きはない）。
 * カードも数も (project_id, status, position) のインデックスで列ごとに読んで上限で止めるので、D1 が読む行は
 * 出すカードの数に比例する（課題の数には比例しない）
 */
export async function listBoard(
	ctx: AppContext,
	key: string,
	filters: Omit<IssueFilters, 'status'> = {},
	limits: BoardLimits = {}
): Promise<{
	statuses: StatusDef[];
	columns: Record<Status, BoardCard[]>;
	totals: Record<Status, number>;
	milestones: MilestoneRow[];
}> {
	const { db } = ctx;
	const filtered = Object.values(filters).some((v) => v !== undefined);
	const custom = customLimits(limits);
	const of = ofProject(db, key);
	const where = filtered
		? filterConds(key, of, { ...filters, status: undefined })
		: filterConds('', of, {});
	const [access, statuses, rows, counts, milestones] = await ctx.readBatch([
		// アクセスとステータスはレイアウトも引く（同じ文は 1 回だけ送る。db/read-batch.ts）
		projectAccessRead(ctx, key),
		cachedByKey(statusesQuery)(db, key),
		filtered || custom.length > 0
			? boardCardsQuery(db, of, where, custom)
			: unfilteredBoardCards(db, key),
		filtered || custom.length > 0
			? boardCountsQuery(db, of, where, custom)
			: unfilteredBoardCounts(db, key),
		cachedByKey(milestonesQuery)(db, key)
	]);
	checkProjectAccess(ctx, access);
	const columns: Record<Status, BoardCard[]> = Object.fromEntries(
		statuses.map((s) => [s.key, [] as BoardCard[]])
	);
	const totals: Record<Status, number> = Object.fromEntries(statuses.map((s) => [s.key, 0]));
	// 行は position の小さい順。完了の列だけ逆にする
	for (const { status, assigneesJson, categoriesJson, ...card } of rows) {
		columns[status]?.push({
			...card,
			assigneeNames: JSON.parse(assigneesJson) as string[],
			categoryNames: JSON.parse(categoriesJson) as string[]
		});
	}
	columns[DONE_STATUS]?.reverse();
	// 数はステータスの定義ごとに数える。ステータスを削除するとその課題は初期ステータスに移るので（deleteStatus）、
	// 定義のないステータスの課題は無い
	for (const { status, n } of counts) if (status in totals) totals[status] = n;
	return { statuses, columns, totals, milestones };
}

/** 既定（BOARD_PAGE_SIZE）と違う列の上限を、ステータスの順に並べる（文の形を決めるので順を固定する） */
function customLimits(limits: BoardLimits): [Status, number][] {
	return Object.entries(limits)
		.filter((e): e is [Status, number] => typeof e[1] === 'number' && e[1] !== BOARD_PAGE_SIZE)
		.map(([s, n]): [Status, number] => [s, Math.min(BOARD_COLUMN_MAX, Math.max(1, Math.floor(n)))])
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * カンバンのカード（列ごとに上限まで）。カードに出すものと、列に分けるステータス・移動に使う ID だけを読む。
 * カードの数（数百）だけ、D1 の結果の解釈・画面へ渡すデータの書き出しが増えるため（担当者・カテゴリーも名前だけ）。
 *
 * 出すカードの ID は列ごとの副問い合わせで選ぶ。各列は status で絞って position の順に上限まで読むので、
 * (project_id, status, position) のインデックスの順に読み、上限に達したら止まる（列の全課題は読まない）。
 * - 既定の上限の列: ステータスの定義ごとに相関副問い合わせで選ぶ（ステータスを先に引かずに 1 文で済む）
 * - 上限を変えた列（custom）と完了の列: 1 列ずつの副問い合わせ（SQLite の LIMIT は外側の値を参照できない）
 * 副問い合わせの "issue" は内側の from を指す（where は "issue" の列で書いてある）
 */
function boardCardsQuery(
	db: DB,
	of: ProjectCond,
	where: SQL | undefined,
	custom: [Status, number][]
) {
	const limitOf = new Map(custom);
	const column = (status: Status, limit: number) => {
		const dir = status === DONE_STATUS ? sql`desc` : sql`asc`;
		return sql`select * from (select ${issue.id} from ${issue} where ${and(where, eq(issue.status, status))}
			order by ${issue.position} ${dir}, ${issue.number} ${dir} limit ${limit})`;
	};
	const separate = [...new Set<Status>([...limitOf.keys(), DONE_STATUS])];
	const byDefinition = sql`select "x"."id" from ${issueStatus}
		join ${issue} as "x" on "x"."id" in (
			select ${issue.id} from ${issue} where ${and(where, sql`${issue.status} = ${issueStatus.key}`)}
			order by ${issue.position}, ${issue.number} limit ${BOARD_PAGE_SIZE}
		)
		where ${and(of(issueStatus.projectId), sql`not ${inList(issueStatus.key, separate)}`)}`;
	const ids = [byDefinition, ...separate.map((s) => column(s, limitOf.get(s) ?? BOARD_PAGE_SIZE))];
	// 外側は ID だけで絞る（where も重ねると、SQLite がプロジェクトの全課題を読んで ID を照らす形を選ぶ）
	const shown = sql`${issue.id} in (${sql.join(ids, sql` union all `)})`;
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
		.where(shown)
		.orderBy(asc(issue.position), asc(issue.number));
}

/**
 * 列ごとの課題の数（絞り込んだ後、上限で切る前）。列ごとに max(読み込む数, BOARD_COUNT_LIMIT) + 1 件で数えるのをやめる。
 * group by で数えるとプロジェクトのすべての課題を読むので、ステータスの定義ごとに相関副問い合わせで、
 * (project_id, status, position) のインデックスの範囲を上限まで読む。読み込む数を変えた列（custom）は上限が違うので別の行にする
 */
function boardCountsQuery(
	db: DB,
	of: ProjectCond,
	where: SQL | undefined,
	custom: [Status, number][]
) {
	const counted = (limit: number) =>
		sql<number>`(select count(*) from (select 1 from ${issue}
			where ${and(where, sql`${issue.status} = ${issueStatus.key}`)}
			limit ${Math.max(limit, BOARD_COUNT_LIMIT) + 1}))`.as('board_count');
	const row = (limit: number, which: SQL | undefined) =>
		db
			.select({ status: issueStatus.key, n: counted(limit) })
			.from(issueStatus)
			.where(and(of(issueStatus.projectId), which));
	const separate = custom.map(([s]) => s);
	const byDefinition = row(
		BOARD_PAGE_SIZE,
		separate.length > 0 ? sql`not ${inList(issueStatus.key, separate)}` : undefined
	);
	return custom.reduce<ReturnType<typeof row>>(
		(q, [s, limit]) => q.unionAll(row(limit, eq(issueStatus.key, s))) as ReturnType<typeof row>,
		byDefinition
	);
}

// 絞り込みのないカンバン（開いたとき）は、組み立てを使い回す（db/cached-read.ts）。絞り込むと値によって文の形が変わる
const unfilteredBoardCards = cachedByKey((db, of) =>
	boardCardsQuery(db, of, filterConds('', of, {}), [])
);
const unfilteredBoardCounts = cachedByKey((db, of) =>
	boardCountsQuery(db, of, filterConds('', of, {}), [])
);

type BoardCardRow = Awaited<ReturnType<typeof boardCardsQuery>>[number];
/** カンバンのカード 1 枚 */
export type BoardCard = Omit<BoardCardRow, 'status' | 'assigneesJson' | 'categoriesJson'> & {
	assigneeNames: string[];
	categoryNames: string[];
};

/** タイムラインに行を出す課題（日付のある課題）の数。表示の開始日に近いものから */
export const SCHEDULED_LIMIT = 300;

export interface TimelineView {
	/**
	 * 表示の開始日（'YYYY-MM-DD'）。完了した課題のうち、この日より前に終わったもの（期限、なければ開始日が前）は返さない。
	 * 省略すると完了した課題もすべて返す
	 */
	from?: string;
	filters?: Pick<IssueFilters, 'status' | 'typeId' | 'assigneeId' | 'categoryId' | 'milestoneId'>;
}

/**
 * タイムライン（remote query の getTimeline）に要るもの。1 回の batch（D1 への 1 往復）で引く。
 * 日付のある課題（完了したものは view.from 以降に終わるものだけ。view.from に近い順に SCHEDULED_LIMIT 件まで）を
 * 絞り込んで返す。scheduledMore は上限を超えて出していない課題があるか。日付のない未完了の課題はタイムラインに出さず、
 * あるかどうか（hasUnscheduled）だけを返す（一覧は課題一覧の「日付なし」の絞り込みで見る）。
 * どちらも数は数えない（数えるには対象の課題をすべて読むことになり、D1 の読み取り行数が増える）。
 * 未完了の課題は表示範囲の外でも返す（範囲外の課題にも行を出すため）。並べ替え・グループ化はクライアント側で行う。
 * Backlog から移した数千件のプロジェクトでは、課題をすべて返すと 1 回の表示の CPU 時間が 100ms を超える
 */
export async function listTimeline(
	ctx: AppContext,
	key: string,
	view: TimelineView = {}
): Promise<{
	scheduled: TimelineItem[];
	scheduledMore: boolean;
	hasUnscheduled: boolean;
	milestones: MilestoneRow[];
	categories: CategoryRow[];
	assignees: Awaited<ReturnType<typeof assignableUsersQuery>>;
}> {
	const { db } = ctx;
	const { status, ...filters } = view.filters ?? {};
	const filtered = status !== undefined || Object.values(filters).some((v) => v !== undefined);
	// 絞り込みがなく開始日のあるとき（開いたとき）は、組み立てを使い回す（db/cached-read.ts）
	const of = ofProject(db, key);
	const q =
		filtered || view.from === undefined
			? timelineQueries(db, of, filterConds(key, of, filters), view.from, status)
			: {
					scheduled: unfilteredTimeline.scheduled(db, { key, from: view.from }),
					unscheduled: unfilteredTimeline.unscheduled(db, { key })
				};
	const [access, rows, [unscheduled], milestones, categories, assignees] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		q.scheduled,
		q.unscheduled,
		cachedByKey(milestonesQuery)(db, key),
		cachedByKey(categoriesQuery)(db, key),
		cachedByKey(assignableUsersQuery)(db, key)
	]);
	const p = checkProjectAccess(ctx, access);
	// 上限より 1 件多く引いて、超えるかどうかを知る。行の順は決めずに引くので、近い順に並べて上限で切る
	const shown = rows
		.sort((a, b) => a.distance - b.distance || a.number - b.number)
		.slice(0, SCHEDULED_LIMIT);
	// 担当者の名前は担当者にできる人の一覧から付ける。無効化・脱退した人が担当のままなら、その人だけ引く（ふだんは往復しない）
	const names = new Map(assignees.map((u) => [u.id, u.name]));
	const missing = [...new Set(shown.flatMap((r) => r.assigneeIds))].filter((id) => !names.has(id));
	if (missing.length > 0) {
		const others = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inList(user.id, missing));
		for (const u of others) names.set(u.id, u.name);
	}
	const milestoneNames = new Map(milestones.map((m) => [m.id, m.name]));
	return {
		// 画面へは番号順で渡す
		scheduled: shown
			.sort((a, b) => a.number - b.number)
			.map((r): TimelineItem => ({
				id: r.id,
				number: r.number,
				title: r.title,
				status: r.status,
				startDate: r.startDate,
				dueDate: r.dueDate,
				milestoneId: r.milestoneId,
				milestoneName: r.milestoneId ? (milestoneNames.get(r.milestoneId) ?? null) : null,
				// assignee_ids の順。名前が引けない人（存在しない ID）は除く
				assignees: r.assigneeIds.flatMap((id) => {
					const name = names.get(id);
					return name === undefined ? [] : [{ id, name }];
				}),
				canEdit: !p.archivedAt && can(ctx.actor, 'issue:edit', { reporterId: r.reporterId })
			})),
		scheduledMore: rows.length > SCHEDULED_LIMIT,
		hasUnscheduled: Boolean(unscheduled?.found),
		milestones,
		categories,
		assignees
	};
}

/**
 * タイムラインの文（日付のある課題と、日付のない未完了の課題があるか）。where はステータス以外の絞り込み。
 * from は表示の開始日（cachedRead のプレースホルダーでもよい）。省略すると完了した課題もすべて対象にし、番号順に上限まで。
 *
 * D1 の読み取り行数を抑えるため、プロジェクトの課題を全部は読まない。対象になりうる「未完了の課題」と
 * 「from 以降に終わる完了した課題」を、索引 issue_timeline_idx（プロジェクト・ステータス・終わる日）の範囲で別々に読んで
 * UNION ALL でつなぐ（OR で 1 つの条件に書くと SQLite は索引を使わずプロジェクトの全課題を読む）。
 * ステータスで絞るときは、その範囲だけを読む（条件を重ねるだけだと、読んでから捨てる行も数えられる）。
 * 古い課題の多い（ほとんどが完了した）プロジェクトほど読む行が減る
 */
function timelineQueries(
	db: DB,
	of: ProjectCond,
	where: SQL | undefined,
	from: string | Placeholder | undefined,
	status?: string
) {
	// 未完了の課題。<> では索引の範囲にならないので、完了の前と後の 2 つに分ける
	const open = [sql`${issue.status} < ${DONE_STATUS}`, sql`${issue.status} > ${DONE_STATUS}`];
	// 完了した課題は from 以降に終わる（期限、なければ開始日）ものだけ。式は issue_timeline_idx と同じにする
	const done = and(
		eq(issue.status, DONE_STATUS),
		from === undefined ? undefined : sql`coalesce(${issue.dueDate}, ${issue.startDate}) >= ${from}`
	);
	const ranges =
		status === undefined
			? [...open, done]
			: status === 'open'
				? open
				: status === DONE_STATUS
					? [done]
					: [eq(issue.status, status)];
	// 開始日から期限までの間と from との隔たり（日数）。間に from を含めば 0。from がなければ番号順
	const distance =
		from === undefined
			? sql<number>`${issue.number}`
			: sql<number>`max(0, julianday(coalesce(${issue.startDate}, ${issue.dueDate})) - julianday(${from}),
			julianday(${from}) - julianday(coalesce(${issue.dueDate}, ${issue.startDate})))`;
	// 行に出すものと、グループ分け（担当者・マイルストーン）・編集の可否に使うものだけを読む。
	// 名前（担当者・マイルストーン）は同じ batch で読む一覧から listTimeline で付ける（行ごとに引くと D1 の読み取りが増える）
	const scheduledOf = (range: SQL | undefined) =>
		db
			.select({
				id: issue.id,
				number: issue.number,
				distance: distance.as('distance'),
				title: issue.title,
				status: issue.status,
				startDate: issue.startDate,
				dueDate: issue.dueDate,
				milestoneId: issue.milestoneId,
				assigneeIds: issue.assigneeIds,
				reporterId: issue.reporterId
			})
			.from(issue)
			.where(and(where, range, or(isNotNull(issue.startDate), isNotNull(issue.dueDate))))
			.$dynamic();
	const candidates = ranges
		.slice(1)
		.reduce((u, range) => u.unionAll(scheduledOf(range)), scheduledOf(ranges[0]))
		.as('candidates');
	// 候補を読むときに行の列も読み、近い順に上限まで切ったものをそのまま返す（選んだ ID から課題を引き直さない）
	const scheduled = db
		.select({
			id: candidates.id,
			number: candidates.number,
			distance: candidates.distance,
			title: candidates.title,
			status: candidates.status,
			startDate: candidates.startDate,
			dueDate: candidates.dueDate,
			milestoneId: candidates.milestoneId,
			assigneeIds: candidates.assigneeIds,
			reporterId: candidates.reporterId
		})
		.from(candidates)
		.orderBy(candidates.distance, candidates.number)
		.limit(SCHEDULED_LIMIT + 1);
	// 日付のない未完了の課題が 1 件でもあるか。未完了のステータスごとに索引（ステータス・終わる日が null）を引き、
	// 見つかったところで止める（未完了の課題を範囲で読むと、1 件もないときに未完了の課題をすべて読む）。
	// 課題のステータスは必ずプロジェクトのステータスにある（ステータスを消すときは課題を移す）
	const unscheduledStatus =
		status === undefined || status === 'open'
			? sql`${issue.status} in (select ${issueStatus.key} from ${issueStatus}
				where ${and(of(issueStatus.projectId), ne(issueStatus.key, DONE_STATUS))})`
			: status === DONE_STATUS
				? sql`0`
				: eq(issue.status, status);
	const unscheduled = db
		.select({ one: sql`1` })
		.from(issue)
		.where(
			and(where, unscheduledStatus, sql`coalesce(${issue.dueDate}, ${issue.startDate}) is null`)
		)
		.limit(1);
	return {
		scheduled,
		unscheduled: db
			.select({ found: sql<number>`exists ${unscheduled}`.as('found') })
			.from(project)
			.where(of(project.id))
	};
}

type TimelineRow = Awaited<ReturnType<typeof timelineQueries>['scheduled']>[number];
/** タイムラインの行 1 つ */
export type TimelineItem = Omit<TimelineRow, 'assigneeIds' | 'reporterId' | 'distance'> & {
	milestoneName: string | null;
	assignees: AssigneeRef[];
	canEdit: boolean;
};

// 絞り込みのないタイムライン（開いたとき）の文。開始日は日ごとに変わるのでプレースホルダーにする
const unfilteredTimelineQueries = (db: DB, p: { key: Placeholder; from?: Placeholder }) => {
	const of = ofProject(db, p.key);
	return timelineQueries(db, of, filterConds('', of, {}), p.from);
};
const unfilteredTimeline = {
	scheduled: cachedRead(['key', 'from'], (db, p) => unfilteredTimelineQueries(db, p).scheduled),
	unscheduled: cachedRead(['key'], (db, p) => unfilteredTimelineQueries(db, p).unscheduled)
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
	// 片側だけ指定されたときは、列のすべての課題（画面に読み込んでいないものも含む）のうち、指定された課題の
	// 隣の課題との間に入れる。カンバンは列の一部しか読み込んでいないことがあり（BOARD_PAGE_SIZE ずつ・絞り込み）、
	// 見えている課題の隣に置かないと、落とした所から離れた位置に入る。どちらも無ければ（空の列）列の末尾
	const inColumn = and(
		eq(issue.projectId, p.id),
		eq(issue.status, data.status),
		ne(issue.id, cur.id),
		isNull(issue.deletedAt)
	);
	if (!afterId) {
		const [next] = await ctx.db
			.select({
				position: sql<string | null>`${lo === null ? sql`max` : sql`min`}(${issue.position})`
			})
			.from(issue)
			.where(lo === null ? inColumn : and(inColumn, sql`${issue.position} > ${lo}`));
		if (lo === null) lo = next?.position ?? null;
		else hi = next?.position ?? null;
	} else if (!beforeId) {
		const [prev] = await ctx.db
			.select({ position: sql<string | null>`max(${issue.position})` })
			.from(issue)
			.where(and(inColumn, sql`${issue.position} < ${hi}`));
		lo = prev?.position ?? null;
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
