// 課題の起票・更新の入力検証と、書き込む値の組み立て。1 件の起票・更新と一括 API の両方から使う。
// DB に触れない同期関数にしておき、問い合わせは loadFieldSets でまとめて先に済ませる。
import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import {
	INITIAL_STATUS,
	PRIORITIES,
	PRIORITY_LABEL,
	RESOLUTIONS,
	RESOLUTION_LABEL,
	type IssueChangeItem,
	type StatusDef
} from '$lib/labels';
import { authorize, type Actor } from '../authz';
import type { DB } from '../db';
import { category, issue, issueType, milestone, user } from '../db/schema';
import { AppError } from '../errors';
import type { IssueEvent } from '../notifications';
import { DateOrEmptySchema as DateOrEmpty, emptyToNull, parse } from '../validation';
import { listStatusesOf } from './issue-fields';
import { listAssignableUsers } from './projects';

export type IssuePatch = Partial<typeof issue.$inferInsert>;
export type IssueRow = typeof issue.$inferSelect;
/** insert する値のうち、projectId・number・position 以外（呼び出し側で足す） */
export type CreateValues = Omit<typeof issue.$inferInsert, 'projectId' | 'number' | 'position'> & {
	id: string;
	status: string;
	description: string;
};

/** 親課題の候補を確かめるための、プロジェクトの課題の最小限の情報 */
export type IssueRef = {
	id: string;
	number: number;
	title: string;
	parentId: string | null;
	deleted: boolean;
};

/** プロジェクトの分類項目・担当可能な人（id → 名前）・課題（親子関係の検証用） */
export type FieldSets = {
	statuses: StatusDef[];
	typeIds: Map<string, string>;
	categoryIds: Map<string, string>;
	milestoneIds: Map<string, string>;
	/** 完了済みのマイルストーン（新しく割り当てられない） */
	completedMilestoneIds: Set<string>;
	assignable: Map<string, string>;
	issuesByNumber: Map<number, IssueRef>;
	issuesById: Map<string, IssueRef>;
	/** 削除されていない子課題を持つ課題の id */
	parentIds: Set<string>;
};

export const MAX_ASSIGNEES = 10;

export async function loadFieldSets(db: DB, projectId: string): Promise<FieldSets> {
	const [statuses, types, categories, milestones, assignable, issues] = await Promise.all([
		listStatusesOf(db, projectId),
		db
			.select({ id: issueType.id, name: issueType.name })
			.from(issueType)
			.where(eq(issueType.projectId, projectId)),
		db
			.select({ id: category.id, name: category.name })
			.from(category)
			.where(eq(category.projectId, projectId)),
		db
			.select({ id: milestone.id, name: milestone.name, completedAt: milestone.completedAt })
			.from(milestone)
			.where(eq(milestone.projectId, projectId)),
		listAssignableUsers(db, projectId),
		db
			.select({
				id: issue.id,
				number: issue.number,
				title: issue.title,
				parentId: issue.parentId,
				deletedAt: issue.deletedAt
			})
			.from(issue)
			.where(eq(issue.projectId, projectId))
	]);
	const refs: IssueRef[] = issues.map(({ deletedAt, ...r }) => ({ ...r, deleted: !!deletedAt }));
	const toMap = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
	return {
		statuses,
		typeIds: toMap(types),
		categoryIds: toMap(categories),
		milestoneIds: toMap(milestones),
		completedMilestoneIds: new Set(milestones.filter((m) => m.completedAt).map((m) => m.id)),
		assignable: toMap(assignable),
		issuesByNumber: new Map(refs.map((r) => [r.number, r])),
		issuesById: new Map(refs.map((r) => [r.id, r])),
		parentIds: new Set(refs.filter((r) => !r.deleted && r.parentId).map((r) => r.parentId!))
	};
}

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
export const StatusSchema = v.pipe(v.string(), v.minLength(1, 'ステータスを選択してください'));
const ResolutionOrEmpty = v.union(
	[v.literal(''), v.picklist(RESOLUTIONS)],
	'完了理由を選択してください'
);

/** '' は担当者なし。重複と空文字は除き、指定した順を保つ */
const AssigneeIdsSchema = v.pipe(
	v.union([v.literal(''), v.array(v.string())], '担当者は ID の配列で指定してください'),
	v.transform((ids) => [...new Set(ids === '' ? [] : ids.filter(Boolean))]),
	v.maxLength(MAX_ASSIGNEES, `担当者は${MAX_ASSIGNEES}人までです`)
);
/** '' は親課題なし。番号（12）か課題キー（ACME-12）で指定する */
const ParentSchema = v.union(
	[
		v.literal(''),
		v.pipe(v.number(), v.integer(), v.minValue(1)),
		v.pipe(
			v.string(),
			v.trim(),
			v.regex(/^(?:[A-Za-z][A-Za-z0-9_]*-|#)?\d{1,9}$/),
			v.transform((s) => Number(s.match(/\d+$/)![0]))
		)
	],
	'親課題は課題番号か課題キーで指定してください'
);

const CreateInput = v.object({
	title: TitleSchema,
	typeId: v.optional(v.string()),
	description: v.optional(DescriptionSchema, ''),
	status: v.optional(StatusSchema, INITIAL_STATUS),
	priority: v.optional(v.picklist(PRIORITIES), 'none'),
	startDate: v.optional(DateOrEmpty),
	dueDate: v.optional(DateOrEmpty),
	assigneeIds: v.optional(AssigneeIdsSchema, []),
	parentNumber: v.optional(ParentSchema),
	categoryId: v.optional(v.string()),
	milestoneId: v.optional(v.string())
});

const UpdateInput = v.object({
	title: v.optional(TitleSchema),
	typeId: v.optional(v.string()),
	resolution: v.optional(ResolutionOrEmpty),
	description: v.optional(DescriptionSchema),
	priority: v.optional(v.picklist(PRIORITIES)),
	startDate: v.optional(DateOrEmpty),
	dueDate: v.optional(DateOrEmpty),
	status: v.optional(StatusSchema),
	assigneeIds: v.optional(AssigneeIdsSchema),
	parentNumber: v.optional(ParentSchema),
	categoryId: v.optional(v.string()),
	milestoneId: v.optional(v.string())
});

function invalid(field: string, msg: string): AppError {
	return new AppError('validation', msg, { [field]: [msg] });
}

function assertDateRange(start: string | null, due: string | null): void {
	if (start && due && start > due) {
		throw invalid('startDate', '開始日は期限日以前の日付にしてください');
	}
}

export function assertStatusIn(fields: FieldSets, key: string): void {
	if (!fields.statuses.some((s) => s.key === key)) {
		throw invalid('status', 'ステータスが見つかりません');
	}
}

function assertTypeIn(fields: FieldSets, id: string): void {
	if (!fields.typeIds.has(id)) throw invalid('typeId', '課題種別が見つかりません');
}

function assertCategoryIn(fields: FieldSets, id: string): void {
	if (!fields.categoryIds.has(id)) throw invalid('categoryId', 'カテゴリーが見つかりません');
}

/** 新しく割り当てる場合に使う。完了済みのマイルストーンは割り当てられない。 */
function assertMilestoneIn(fields: FieldSets, id: string): void {
	if (!fields.milestoneIds.has(id)) throw invalid('milestoneId', 'マイルストーンが見つかりません');
	if (fields.completedMilestoneIds.has(id)) {
		throw invalid('milestoneId', '完了済みのマイルストーンは設定できません');
	}
}

function assertAssignableIn(fields: FieldSets, ids: string[]): void {
	if (ids.some((id) => !fields.assignable.has(id))) {
		throw invalid('assigneeIds', 'このユーザーは担当者にできません');
	}
}

/**
 * 親課題の番号を id に変える。'' は null。子課題は 1 階層までなので、子課題を親にはできない。
 * self は更新する課題（起票では undefined）
 */
function resolveParent(
	fields: FieldSets,
	number: number | '' | undefined,
	self?: IssueRow
): string | null | undefined {
	if (number === undefined) return undefined;
	if (number === '') return null;
	const p = fields.issuesByNumber.get(number);
	if (!p || p.deleted) throw invalid('parentNumber', '親課題が見つかりません');
	if (self && p.id === self.id) throw invalid('parentNumber', '自分自身は親課題にできません');
	if (self && p.id === self.parentId) return p.id;
	if (p.parentId) throw invalid('parentNumber', '子課題を親課題にはできません');
	if (self && fields.parentIds.has(self.id)) {
		throw invalid('parentNumber', '子課題がある課題は、ほかの課題の子課題にできません');
	}
	return p.id;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/** 起票の検証と権限チェック。プロジェクトが書き込み可能かは呼び出し側で確かめること。 */
export function prepareCreate(actor: Actor, fields: FieldSets, input: unknown): CreateValues {
	authorize(actor, 'issue:create');
	const data = parse(CreateInput, input);
	const { assigneeIds } = data;
	if (assigneeIds.length > 0) {
		authorize(actor, 'issue:assign');
		assertAssignableIn(fields, assigneeIds);
	}
	if (data.status !== INITIAL_STATUS) {
		authorize(actor, 'issue:changeStatus');
		assertStatusIn(fields, data.status);
	}
	const parentId = resolveParent(fields, data.parentNumber) ?? null;
	const typeId = emptyToNull(data.typeId) ?? null;
	if (typeId) assertTypeIn(fields, typeId);
	const startDate = emptyToNull(data.startDate) ?? null;
	const dueDate = emptyToNull(data.dueDate) ?? null;
	assertDateRange(startDate, dueDate);
	const categoryId = emptyToNull(data.categoryId) ?? null;
	if (categoryId) assertCategoryIn(fields, categoryId);
	const milestoneId = emptyToNull(data.milestoneId) ?? null;
	if (milestoneId) assertMilestoneIn(fields, milestoneId);
	return {
		id: uuidv7(),
		title: data.title,
		typeId,
		description: data.description,
		status: data.status,
		priority: data.priority,
		startDate,
		dueDate,
		assigneeIds,
		parentId,
		categoryId,
		milestoneId,
		reporterId: actor.id
	};
}

/**
 * 更新の検証と権限チェック。未送信（undefined）の項目は変更しない。値が変わった項目だけ権限を確認する。
 * position は含めない（status が入っていれば呼び出し側で振る）。
 * プロジェクトが書き込み可能か、課題が削除済みでないかは呼び出し側で確かめること。
 */
export function preparePatch(
	actor: Actor,
	fields: FieldSets,
	cur: IssueRow,
	input: unknown
): IssuePatch {
	const data = parse(UpdateInput, input);
	const res = { reporterId: cur.reporterId };
	const patch: IssuePatch = {};

	const startDate = emptyToNull(data.startDate);
	const dueDate = emptyToNull(data.dueDate);
	const categoryId = emptyToNull(data.categoryId);
	const milestoneId = emptyToNull(data.milestoneId);
	const typeId = emptyToNull(data.typeId);
	const resolution = data.resolution === undefined ? undefined : data.resolution || null;
	if (data.title !== undefined && data.title !== cur.title) patch.title = data.title;
	if (typeId !== undefined && typeId !== cur.typeId) patch.typeId = typeId;
	if (resolution !== undefined && resolution !== cur.resolution) patch.resolution = resolution;
	if (data.description !== undefined && data.description !== cur.description)
		patch.description = data.description;
	if (data.priority !== undefined && data.priority !== cur.priority) patch.priority = data.priority;
	if (startDate !== undefined && startDate !== cur.startDate) patch.startDate = startDate;
	if (dueDate !== undefined && dueDate !== cur.dueDate) patch.dueDate = dueDate;
	if (categoryId !== undefined && categoryId !== cur.categoryId) patch.categoryId = categoryId;
	if (milestoneId !== undefined && milestoneId !== cur.milestoneId) patch.milestoneId = milestoneId;
	const parentId = resolveParent(fields, data.parentNumber, cur);
	if (parentId !== undefined && parentId !== cur.parentId) patch.parentId = parentId;
	if (Object.keys(patch).length > 0) authorize(actor, 'issue:edit', res);
	if (patch.startDate !== undefined || patch.dueDate !== undefined) {
		assertDateRange(
			patch.startDate !== undefined ? patch.startDate : cur.startDate,
			patch.dueDate !== undefined ? patch.dueDate : cur.dueDate
		);
	}
	if (patch.typeId) assertTypeIn(fields, patch.typeId);
	if (patch.categoryId) assertCategoryIn(fields, patch.categoryId);
	if (patch.milestoneId) assertMilestoneIn(fields, patch.milestoneId);

	if (data.status !== undefined && data.status !== cur.status) {
		authorize(actor, 'issue:changeStatus', res);
		assertStatusIn(fields, data.status);
		patch.status = data.status;
	}

	const ids = data.assigneeIds;
	if (ids !== undefined && !sameIds(ids, cur.assigneeIds)) {
		authorize(actor, 'issue:assign', res);
		// 無効化された人など、もう担当にできない人が元から担当なら外さずに残せる
		assertAssignableIn(
			fields,
			ids.filter((id) => !cur.assigneeIds.includes(id))
		);
		patch.assigneeIds = ids;
	}
	return patch;
}

/**
 * 一括更新で、要素どうしの組み合わせによって子課題の子課題ができないか確かめる
 * （1 件ずつの検証は更新前の親子関係で行うため）
 */
export function assertOneLevel(
	fields: FieldSets,
	changes: { cur: IssueRow; patch: IssuePatch }[]
): void {
	const parentOf = new Map<string, string | null>();
	for (const [id, r] of fields.issuesById) if (!r.deleted) parentOf.set(id, r.parentId);
	for (const { cur, patch } of changes) {
		if (patch.parentId !== undefined) parentOf.set(cur.id, patch.parentId);
	}
	const parents = new Set([...parentOf.values()].filter(Boolean));
	for (const { cur, patch } of changes) {
		if (patch.parentId && (parentOf.get(patch.parentId) || parents.has(cur.id))) {
			throw invalid(
				'parentNumber',
				`子課題の子課題になる組み合わせがあります（#${cur.number}）。子課題は 1 階層までです`
			);
		}
	}
}

/**
 * 担当者を変える課題のうち、元の担当者で担当可能な人に含まれない（無効化・脱退した）人の名前を引く。
 * describeChanges の otherUsers に渡す。該当がなければ問い合わせない。
 */
export async function loadFormerAssigneeNames(
	db: DB,
	fields: FieldSets,
	changes: { cur: IssueRow; patch: IssuePatch }[]
): Promise<Map<string, string>> {
	const ids = new Set<string>();
	for (const { cur, patch } of changes) {
		if (patch.assigneeIds === undefined) continue;
		for (const id of cur.assigneeIds) if (!fields.assignable.has(id)) ids.add(id);
	}
	if (ids.size === 0) return new Map();
	const rows = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(inArray(user.id, [...ids]));
	return new Map(rows.map((r) => [r.id, r.name]));
}

/** 変わった項目を、変更時点の表示名で書き出す（履歴に残すため） */
export function describeChanges(
	fields: FieldSets,
	cur: IssueRow,
	patch: IssuePatch,
	otherUsers: Map<string, string> = new Map()
): IssueChangeItem[] {
	// カンバンで同じ列の中を動かしたときは status が同じ値で来る
	const statusChanged = patch.status !== undefined && patch.status !== cur.status;
	const changes: IssueChangeItem[] = [];
	const add = (
		field: IssueChangeItem['field'],
		from: string | null | undefined,
		to: string | null | undefined
	) => changes.push({ field, from: from ?? null, to: to ?? null });
	const lookup = (m: Map<string, string>, id: string | null | undefined) =>
		id ? (m.get(id) ?? null) : null;
	const userNames = (ids: readonly string[]) =>
		ids.length === 0
			? null
			: ids.map((id) => lookup(fields.assignable, id) ?? lookup(otherUsers, id) ?? '—').join('、');
	const issueLabel = (id: string | null | undefined) => {
		const r = id ? fields.issuesById.get(id) : undefined;
		return r ? `#${r.number} ${r.title}` : null;
	};

	if (patch.title !== undefined) add('title', cur.title, patch.title);
	if (patch.description !== undefined) add('description', cur.description, patch.description);
	if (patch.typeId !== undefined)
		add('type', lookup(fields.typeIds, cur.typeId), lookup(fields.typeIds, patch.typeId));
	if (statusChanged) {
		const name = (k: string) => fields.statuses.find((st) => st.key === k)?.name ?? k;
		add('status', name(cur.status), name(patch.status!));
	}
	if (patch.resolution !== undefined)
		add(
			'resolution',
			cur.resolution && RESOLUTION_LABEL[cur.resolution],
			patch.resolution && RESOLUTION_LABEL[patch.resolution]
		);
	if (patch.priority !== undefined)
		add('priority', PRIORITY_LABEL[cur.priority], PRIORITY_LABEL[patch.priority]);
	if (patch.assigneeIds !== undefined)
		add('assignee', userNames(cur.assigneeIds), userNames(patch.assigneeIds));
	if (patch.parentId !== undefined)
		add('parent', issueLabel(cur.parentId), issueLabel(patch.parentId));
	if (patch.categoryId !== undefined)
		add(
			'category',
			lookup(fields.categoryIds, cur.categoryId),
			lookup(fields.categoryIds, patch.categoryId)
		);
	if (patch.milestoneId !== undefined)
		add(
			'milestone',
			lookup(fields.milestoneIds, cur.milestoneId),
			lookup(fields.milestoneIds, patch.milestoneId)
		);
	if (patch.startDate !== undefined) add('startDate', cur.startDate, patch.startDate);
	if (patch.dueDate !== undefined) add('dueDate', cur.dueDate, patch.dueDate);
	return changes;
}

/** 起票の通知に渡す出来事（1 件・一括で共通） */
export function createEventsOf(values: CreateValues): IssueEvent[] {
	return [
		{
			kind: 'issue_created',
			assigneeIds: values.assigneeIds ?? [],
			priority: values.priority ?? 'none',
			description: values.description
		}
	];
}

/** 更新の通知に渡す出来事（1 件・一括で共通）。通知に関わる変更がなければ空 */
export function updateEventsOf(cur: IssueRow, patch: IssuePatch): IssueEvent[] {
	const events: IssueEvent[] = [];
	const added = patch.assigneeIds?.filter((id) => !cur.assigneeIds.includes(id)) ?? [];
	if (added.length > 0) events.push({ kind: 'assignees_added', assigneeIds: added });
	if (patch.status !== undefined) {
		events.push({ kind: 'status_changed', from: cur.status, to: patch.status });
	}
	if (patch.description !== undefined) {
		events.push({
			kind: 'mentions_added',
			commentId: null,
			before: cur.description,
			after: patch.description
		});
	}
	return events;
}
