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
import { emptyToNull, parse } from '../validation';
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

/** プロジェクトの分類項目と担当可能な人（id → 名前） */
export type FieldSets = {
	statuses: StatusDef[];
	typeIds: Map<string, string>;
	categoryIds: Map<string, string>;
	milestoneIds: Map<string, string>;
	/** 完了済みのマイルストーン（新しく割り当てられない） */
	completedMilestoneIds: Set<string>;
	assignable: Map<string, string>;
};

export async function loadFieldSets(db: DB, projectId: string): Promise<FieldSets> {
	const [statuses, types, categories, milestones, assignable] = await Promise.all([
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
		listAssignableUsers(db, projectId)
	]);
	const toMap = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
	return {
		statuses,
		typeIds: toMap(types),
		categoryIds: toMap(categories),
		milestoneIds: toMap(milestones),
		completedMilestoneIds: new Set(milestones.filter((m) => m.completedAt).map((m) => m.id)),
		assignable: toMap(assignable)
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
const DateOrEmpty = v.union(
	[v.literal(''), v.pipe(v.string(), v.isoDate())],
	'日付の形式が正しくありません'
);
export const StatusSchema = v.pipe(v.string(), v.minLength(1, 'ステータスを選択してください'));
const ResolutionOrEmpty = v.union(
	[v.literal(''), v.picklist(RESOLUTIONS)],
	'完了理由を選択してください'
);

const CreateInput = v.object({
	title: TitleSchema,
	typeId: v.optional(v.string()),
	description: v.optional(DescriptionSchema, ''),
	status: v.optional(StatusSchema, INITIAL_STATUS),
	priority: v.optional(v.picklist(PRIORITIES), 'none'),
	startDate: v.optional(DateOrEmpty),
	dueDate: v.optional(DateOrEmpty),
	assigneeId: v.optional(v.string()),
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
	assigneeId: v.optional(v.string()),
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

function assertAssignableIn(fields: FieldSets, id: string): void {
	if (!fields.assignable.has(id)) throw invalid('assigneeId', 'このユーザーは担当者にできません');
}

/** 起票の検証と権限チェック。プロジェクトが書き込み可能かは呼び出し側で確かめること。 */
export function prepareCreate(actor: Actor, fields: FieldSets, input: unknown): CreateValues {
	authorize(actor, 'issue:create');
	const data = parse(CreateInput, input);
	const assigneeId = emptyToNull(data.assigneeId) ?? null;
	if (assigneeId) {
		authorize(actor, 'issue:assign');
		assertAssignableIn(fields, assigneeId);
	}
	if (data.status !== INITIAL_STATUS) {
		authorize(actor, 'issue:changeStatus', { assigneeId });
		assertStatusIn(fields, data.status);
	}
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
		assigneeId,
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
	const res = { reporterId: cur.reporterId, assigneeId: cur.assigneeId };
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

	const assigneeId = emptyToNull(data.assigneeId);
	if (assigneeId !== undefined && assigneeId !== cur.assigneeId) {
		authorize(actor, 'issue:assign', res);
		if (assigneeId) assertAssignableIn(fields, assigneeId);
		patch.assigneeId = assigneeId;
	}
	return patch;
}

/**
 * 担当者を外す・変える課題のうち、元の担当者が担当可能な人に含まれない（無効化・脱退した）ものの名前を引く。
 * describeChanges の otherUsers に渡す。該当がなければ問い合わせない。
 */
export async function loadFormerAssigneeNames(
	db: DB,
	fields: FieldSets,
	changes: { cur: IssueRow; patch: IssuePatch }[]
): Promise<Map<string, string>> {
	const ids = new Set<string>();
	for (const { cur, patch } of changes) {
		if (patch.assigneeId !== undefined && cur.assigneeId && !fields.assignable.has(cur.assigneeId))
			ids.add(cur.assigneeId);
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
	const userName = (id: string | null | undefined) =>
		lookup(fields.assignable, id) ?? lookup(otherUsers, id);

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
	if (patch.assigneeId !== undefined)
		add('assignee', userName(cur.assigneeId), userName(patch.assigneeId));
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
			assigneeId: values.assigneeId ?? null,
			priority: values.priority ?? 'none',
			description: values.description
		}
	];
}

/** 更新の通知に渡す出来事（1 件・一括で共通）。通知に関わる変更がなければ空 */
export function updateEventsOf(cur: IssueRow, patch: IssuePatch): IssueEvent[] {
	const events: IssueEvent[] = [];
	if (patch.assigneeId !== undefined) {
		events.push({ kind: 'assignee_changed', assigneeId: patch.assigneeId });
	}
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
