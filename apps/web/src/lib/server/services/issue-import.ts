// Backlog の課題 CSV の取り込み。ブラウザで読んだ行を受け取り、確認画面の「計画」を作る（planIssueImport）。
// 実行（importIssues）は送られた行と人の対応表から計画を作り直し、1 回の db.batch で全件成功か全件失敗にする。
// 通知・編集履歴は作らない。DB への問い合わせ回数は件数によらず一定にする。
import { and, asc, eq, gte, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { inList, insertChunks } from '../db/limits';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import {
	MAX_IMPORT_COMMENTS,
	MAX_IMPORT_ISSUES,
	personKey,
	type BacklogIssueRow,
	type IssueImportResult
} from '#lib/backlog-issues.ts';
import { INITIAL_STATUS, RESOLUTION_LABEL, type Resolution } from '#lib/labels.ts';
import { authorize, type Role } from '../authz';
import type { AppContext } from '../context';
import {
	category,
	comment,
	invitation,
	issue,
	issueStatus,
	issueType,
	milestone,
	project,
	projectMember,
	user
} from '../db/schema';
import { AppError } from '../errors';
import { DateOrEmptySchema, parse } from '../validation';
import { tailPositions } from './issue-bulk';
import { categoryIdsValue } from './issue-input';
import { assertWritable, forgetProject, requireProject, type ProjectRow } from './projects';
import { UNKNOWN_USER_ID, unknownUserInsert } from './users';

export interface IssueImportPerson {
	/** CSV の表記（キー ID 順で最初に出たもの） */
	name: string;
	uses: { reporter: number; assignee: number; comment: number };
	/** 自動で選んだ人。match が 'auto' 以外は null */
	userId: string | null;
	match: 'auto' | 'ambiguous' | 'pending' | 'none';
}

export interface IssueImportUser {
	id: string;
	name: string;
	email: string;
	role: Role;
	/** プロジェクトの参加者か（管理者は true） */
	member: boolean;
}

export interface IssueImportPlan {
	issues: number;
	comments: number;
	/** 振る番号の最小と最大（Backlog の番号のままの課題があるので、連番とは限らない） */
	firstNumber: number;
	lastNumber: number;
	/**
	 * Backlog と違う番号になる課題（キー ID 順）。続きの番号を振る。
	 * key: キーの接頭辞がプロジェクトのキーと違う、taken: その番号の課題が既にある
	 */
	renumbered: { key: string; number: number; reason: 'key' | 'taken' }[];
	/** キーの接頭辞（昇順） */
	backlogProjects: string[];
	created: { statuses: string[]; types: string[]; categories: string[]; milestones: string[] };
	people: IssueImportPerson[];
	/** 対応先の候補。名前順 */
	users: IssueImportUser[];
	rowErrors: { rowNumber: number; key: string; reason: string }[];
	/** 件名が長いので切り詰めて取り込む課題のキー（元の件名は本文の末尾に残す） */
	longTitles: string[];
	/** このプロジェクトに取り込み済みのキー（削除済みを含む）。1 つでもあれば取り込めない */
	alreadyImported: string[];
	/** 値を本文末尾に残す知らない列（カスタム属性など）の名前。取り込む行で最初に出た順 */
	extraColumns: string[];
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 50_000;
const COMMENT_MAX = 20_000;
const NAME_MAX = 50;

/** Backlog 既定の状態。同名のステータスがなければ、このキーのステータスへ */
const BACKLOG_STATUS: Record<string, string> = {
	未対応: 'todo',
	処理中: 'in_progress',
	処理済み: 'in_review',
	完了: 'done'
};
const BACKLOG_PRIORITY: Record<string, 'high' | 'medium' | 'low'> = {
	高: 'high',
	中: 'medium',
	低: 'low'
};
const RESOLUTION_BY_LABEL = new Map(
	Object.entries(RESOLUTION_LABEL).map(([k, label]) => [label, k as Resolution])
);

const ISSUES_MESSAGE = `一度に取り込めるのは${MAX_IMPORT_ISSUES}件までです。Backlog で絞り込んで CSV を分けてください`;
const COMMENTS_MESSAGE = `一度に取り込めるコメントは${MAX_IMPORT_COMMENTS.toLocaleString('en-US')}件までです。Backlog で絞り込んで CSV を分けてください`;

const Text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const Short = Text(1000);
const Long = Text(100_000);
const At = v.nullable(v.number());
const RowSchema = v.object({
	rowNumber: v.number(),
	key: Short,
	keyId: v.nullable(v.number()),
	type: Short,
	categories: v.pipe(v.array(Short), v.maxLength(100)),
	milestones: v.pipe(v.array(Short), v.maxLength(100)),
	version: Short,
	title: Short,
	description: Long,
	status: Short,
	priority: Short,
	resolution: Short,
	assignee: Short,
	reporter: Short,
	parentKey: Short,
	createdAt: At,
	updatedAt: At,
	startDate: Short,
	dueDate: Short,
	estimatedHours: Short,
	actualHours: Short,
	attachments: v.number(),
	comments: v.array(v.object({ at: At, author: Short, body: Long })),
	extra: v.pipe(v.array(v.object({ name: Short, value: Long })), v.maxLength(200))
});
const Rows = v.pipe(
	v.array(RowSchema),
	v.maxLength(MAX_IMPORT_ISSUES, ISSUES_MESSAGE),
	v.check(
		(rows) => rows.reduce((n, r) => n + r.comments.length, 0) <= MAX_IMPORT_COMMENTS,
		COMMENTS_MESSAGE
	)
);
const PlanInput = v.object({ rows: Rows });
const ImportInput = v.object({
	rows: Rows,
	people: v.pipe(
		v.array(v.object({ name: Short, userId: v.nullable(Short) })),
		v.maxLength(MAX_IMPORT_ISSUES * 2 + MAX_IMPORT_COMMENTS)
	)
});

/** 1 文のパラメーターが 999 を超えないように、複数行の insert を分ける */

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
/** 課題番号の上限（検索で番号として読む桁数に合わせる） */
const MAX_NUMBER = 999_999_999;

/** 形式を検査済みのキー（PROJ-12）を接頭辞と番号に分ける */
function splitKey(key: string): { prefix: string; number: number } {
	const at = key.lastIndexOf('-');
	return { prefix: key.slice(0, at), number: Number(key.slice(at + 1)) };
}

/**
 * 件名を TITLE_MAX 文字に収める。超える分は「…」にし、絵文字などのサロゲートペアの途中では切らない。
 * 元の件名は composeDescription が本文の末尾に残す
 */
export function clipTitle(title: string): string {
	if (title.length <= TITLE_MAX) return title;
	let end = TITLE_MAX - 1;
	const last = title.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return `${title.slice(0, end)}…`;
}

/** 移行情報の 1 項目。複数行の値は、空でない 2 行目以降を字下げしてリストの続きにする */
const noteItem = (label: string, value: string) =>
	`- ${label}: ${value.replace(/\n(?=[^\n])/g, '\n  ')}`;

/** 本文・コメントの先頭に残す元の名前 */
export const originalName = (name: string) => `（Backlog: ${name}）`;

/** 取り込んだ課題の本文。登録者を対応付けられなかったときは先頭に元の名前、末尾に移行情報を残す */
export function composeDescription(
	r: BacklogIssueRow,
	o: { reporterName: string | null; assigneeName: string | null; parentKey: string | null }
): string {
	const resolutionNote = r.resolution && !RESOLUTION_BY_LABEL.has(r.resolution);
	const lines = [
		`- Backlog から移行: ${r.key}`,
		r.title.length > TITLE_MAX && `- 件名（Backlog）: ${r.title}`,
		o.assigneeName && `- 担当者（Backlog）: ${o.assigneeName}`,
		o.parentKey && `- 親課題（Backlog）: ${o.parentKey}`,
		r.milestones.length > 1 && `- マイルストーン（Backlog）: ${r.milestones.slice(1).join('、')}`,
		r.version && `- 発生バージョン: ${r.version}`,
		r.estimatedHours && `- 予定時間: ${r.estimatedHours}`,
		r.actualHours && `- 実績時間: ${r.actualHours}`,
		resolutionNote && `- 完了理由（Backlog）: ${r.resolution}`,
		r.attachments > 0 && `- 添付ファイル: ${r.attachments} 件（移行していません）`,
		...r.extra.map((x) => noteItem(x.name, x.value))
	].filter(Boolean);
	return [o.reporterName && originalName(o.reporterName), r.description, '---', lines.join('\n')]
		.filter(Boolean)
		.join('\n\n');
}

/** コメントの本文。投稿者を対応付けられなかったときは先頭に元の名前を残す */
export const composeComment = (body: string, authorName: string | null) =>
	authorName ? `${originalName(authorName)}\n\n${body}` : body;

/** 行のエラー。長さは元の名前を足した場合で数える（対応付けで結果が変わらないように） */
function rowError(r: BacklogIssueRow, seen: Set<string>): string | null {
	if (!KEY.test(r.key) || r.keyId === null) return 'キーの形式が正しくありません';
	if (seen.has(r.key)) return 'CSV 内でキーが重複しています';
	seen.add(r.key);
	if (r.title === '') return '件名がありません';
	if (r.createdAt === null) return '登録日の形式が正しくありません';
	if (!v.is(DateOrEmptySchema, r.startDate)) return '開始日の形式が正しくありません';
	if (!v.is(DateOrEmptySchema, r.dueDate)) return '期限日の形式が正しくありません';
	if (r.startDate && r.dueDate && r.startDate > r.dueDate) return '開始日が期限日より後です';
	const names = [r.type, r.status, r.milestones[0] ?? '', ...r.categories];
	if (names.some((n) => n.length > NAME_MAX)) {
		return '種別・カテゴリー・マイルストーン・状態の名前は50文字までです';
	}
	const description = composeDescription(r, {
		reporterName: r.reporter || null,
		assigneeName: r.assignee || null,
		parentKey: r.parentKey || null
	});
	if (description.length > DESCRIPTION_MAX) return '詳細が50,000文字を超えています';
	if (r.comments.some((c) => composeComment(c.body, c.author || null).length > COMMENT_MAX)) {
		return 'コメントが20,000文字を超えています';
	}
	return null;
}

/** 取り込む 1 件。分類項目は ID（新しく作るものは作る予定の ID）に解決済み */
export interface PreparedIssue {
	id: string;
	row: BacklogIssueRow;
	statusKey: string;
	typeId: string | null;
	categoryIds: string[];
	milestoneId: string | null;
	priority: 'none' | 'high' | 'medium' | 'low';
	resolution: Resolution | null;
	/** 親。CSV 内の課題（id は PreparedIssue の id）か、取り込み済みの課題 */
	parentId: string | null;
	/** 親にできなかった親課題キー（本文末尾に残す） */
	parentNote: string | null;
	/** Backlog の番号をそのまま使うときの番号。null は続きの番号を振る */
	number: number | null;
}

export interface BuiltImport {
	plan: IssueImportPlan;
	project: ProjectRow;
	/** キー ID 順 */
	issues: PreparedIssue[];
	newStatuses: { key: string; name: string }[];
	newTypes: { id: string; name: string }[];
	newCategories: { id: string; name: string }[];
	newMilestones: { id: string; name: string }[];
	/** 新しいステータスを入れる位置（「完了」の位置。なければ末尾） */
	statusInsertAt: number;
	typeNextPosition: number;
	/** 続きの番号は、プロジェクトの次の番号とこの値の大きいほうから振る（Backlog の番号のままの課題の最大 + 1） */
	renumberFrom: number;
}

/** 計画と実行で共通の組み立て（人の対応付けは除く） */
export async function buildImport(
	ctx: AppContext,
	key: string,
	rows: BacklogIssueRow[]
): Promise<BuiltImport> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	assertWritable(p);

	const seen = new Set<string>();
	const rowErrors: IssueImportPlan['rowErrors'] = [];
	const valid: BacklogIssueRow[] = [];
	for (const r of rows) {
		const reason = rowError(r, seen);
		if (reason) rowErrors.push({ rowNumber: r.rowNumber, key: r.key, reason });
		else valid.push(r);
	}
	valid.sort((a, b) => a.keyId! - b.keyId!);
	const lookupKeys = [
		...new Set(valid.flatMap((r) => (r.parentKey ? [r.key, r.parentKey] : [r.key])))
	];
	/** Backlog の番号のままにできるか確かめる番号（キーの接頭辞がプロジェクトのキーと同じもの） */
	const ownNumber = (r: BacklogIssueRow): number | null => {
		const k = splitKey(r.key);
		return k.prefix === p.key && k.number >= 1 && k.number <= MAX_NUMBER ? k.number : null;
	};
	const wantedNumbers = valid.map(ownNumber).filter((x) => x !== null);

	const [statuses, types, categories, milestones, users, members, pending, imported, taken] =
		await Promise.all([
			ctx.db
				.select({ key: issueStatus.key, name: issueStatus.name, position: issueStatus.position })
				.from(issueStatus)
				.where(eq(issueStatus.projectId, p.id)),
			ctx.db
				.select({ id: issueType.id, name: issueType.name, position: issueType.position })
				.from(issueType)
				.where(eq(issueType.projectId, p.id)),
			ctx.db
				.select({ id: category.id, name: category.name })
				.from(category)
				.where(eq(category.projectId, p.id))
				.orderBy(asc(category.createdAt), asc(category.id)),
			ctx.db
				.select({ id: milestone.id, name: milestone.name })
				.from(milestone)
				.where(eq(milestone.projectId, p.id)),
			ctx.db
				.select({ id: user.id, name: user.name, email: user.email, role: user.role })
				.from(user)
				.where(and(isNull(user.disabledAt), ne(user.id, UNKNOWN_USER_ID)))
				.orderBy(asc(user.name), asc(user.email)),
			ctx.db
				.select({ userId: projectMember.userId })
				.from(projectMember)
				.where(eq(projectMember.projectId, p.id)),
			ctx.db
				.select({ name: invitation.name })
				.from(invitation)
				.where(
					and(
						isNull(invitation.acceptedAt),
						gte(invitation.expiresAt, new Date()),
						isNotNull(invitation.name)
					)
				),
			lookupKeys.length === 0
				? Promise.resolve([])
				: ctx.db
						.select({
							id: issue.id,
							backlogKey: issue.backlogKey,
							parentId: issue.parentId,
							deletedAt: issue.deletedAt
						})
						.from(issue)
						.where(and(eq(issue.projectId, p.id), inList(issue.backlogKey, lookupKeys))),
			// 削除した課題も番号を持ち続けるので含める
			wantedNumbers.length === 0
				? Promise.resolve([])
				: ctx.db
						.select({ number: issue.number })
						.from(issue)
						.where(and(eq(issue.projectId, p.id), inList(issue.number, wantedNumbers)))
		]);

	// ---- 分類項目（なければ作る。作る順はキー ID 順で最初に出た順） ----
	const newStatuses: BuiltImport['newStatuses'] = [];
	const statusByName = new Map(statuses.map((s) => [s.name, s.key]));
	const statusKeys = new Set(statuses.map((s) => s.key));
	const statusOf = (name: string): string => {
		if (name === '') return INITIAL_STATUS;
		const byName = statusByName.get(name);
		if (byName) return byName;
		const fixed = BACKLOG_STATUS[name];
		if (fixed && statusKeys.has(fixed)) return fixed;
		const created = { key: uuidv7(), name };
		newStatuses.push(created);
		statusByName.set(name, created.key);
		return created.key;
	};
	const named = <T extends { id: string; name: string }>(existing: T[]) => {
		const byName = new Map(existing.map((x) => [x.name, x.id]));
		const created: { id: string; name: string }[] = [];
		const idOf = (name: string): string => {
			let id = byName.get(name);
			if (!id) {
				id = uuidv7();
				created.push({ id, name });
				byName.set(name, id);
			}
			return id;
		};
		return { created, idOf };
	};
	const typeSet = named(types);
	const categorySet = named(categories);
	const milestoneSet = named(milestones);

	const takenNumbers = new Set(taken.map((x) => x.number));
	const prepared = valid.map((r): PreparedIssue => {
		const categoryIds = r.categories.map(categorySet.idOf);
		const own = ownNumber(r);
		return {
			id: uuidv7(),
			row: r,
			statusKey: statusOf(r.status),
			typeId: r.type ? typeSet.idOf(r.type) : null,
			categoryIds,
			milestoneId: r.milestones[0] ? milestoneSet.idOf(r.milestones[0]) : null,
			priority: BACKLOG_PRIORITY[r.priority] ?? 'none',
			resolution: RESOLUTION_BY_LABEL.get(r.resolution) ?? null,
			parentId: null,
			parentNote: null,
			number: own !== null && !takenNumbers.has(own) ? own : null
		};
	});

	// ---- 番号（Backlog の番号のままにできないものは、最大の番号の続きから振る） ----
	const kept = prepared.flatMap((it) => (it.number === null ? [] : [it.number]));
	const renumberFrom = kept.reduce((max, x) => Math.max(max, x), 0) + 1;
	const renumberStart = Math.max(p.nextIssueNumber, renumberFrom);
	const renumbered = prepared
		.filter((it) => it.number === null)
		.map((it, i) => ({
			key: it.row.key,
			number: renumberStart + i,
			reason: splitKey(it.row.key).prefix === p.key ? ('taken' as const) : ('key' as const)
		}));
	const numbers = [...kept, ...renumbered.map((x) => x.number)];
	// 課題のカテゴリーはプロジェクトのカテゴリー順（既存の後に、作る順）
	const categoryOrder = [...categories.map((c) => c.id), ...categorySet.created.map((c) => c.id)];
	for (const it of prepared) {
		it.categoryIds = categoryOrder.filter((id) => it.categoryIds.includes(id));
	}

	// ---- 親子（子課題は 1 階層まで。孫になる組み合わせは親なしにして元のキーを残す） ----
	const byKey = new Map(prepared.map((it) => [it.row.key, it]));
	const importedByKey = new Map(imported.map((i) => [i.backlogKey!, i]));
	/** 親の候補。CSV の行は PreparedIssue、取り込み済みの課題は id */
	const candidate = new Map<PreparedIssue, PreparedIssue | string | null>();
	for (const it of prepared) {
		const k = it.row.parentKey;
		let c: PreparedIssue | string | null = null;
		if (k && k !== it.row.key) {
			const inCsv = byKey.get(k);
			const old = importedByKey.get(k);
			if (inCsv) c = inCsv;
			else if (old && !old.deletedAt && !old.parentId) c = old.id;
		}
		candidate.set(it, c);
	}
	for (const it of prepared) {
		const c = candidate.get(it)!;
		const ok = typeof c === 'string' || (c !== null && candidate.get(c) === null);
		if (ok) it.parentId = typeof c === 'string' ? c : c.id;
		else if (it.row.parentKey) it.parentNote = it.row.parentKey;
	}

	// ---- 人 ----
	const pendingNames = new Set(pending.map((x) => personKey(x.name!)));
	const usersByKey = new Map<string, string[]>();
	for (const u of users) {
		const k = personKey(u.name);
		usersByKey.set(k, [...(usersByKey.get(k) ?? []), u.id]);
	}
	const people = new Map<string, IssueImportPerson>();
	const use = (name: string, kind: keyof IssueImportPerson['uses']) => {
		if (!name) return;
		const k = personKey(name);
		let person = people.get(k);
		if (!person) {
			const matched = usersByKey.get(k) ?? [];
			const match =
				matched.length === 1
					? 'auto'
					: matched.length > 1
						? 'ambiguous'
						: pendingNames.has(k)
							? 'pending'
							: 'none';
			person = {
				name,
				uses: { reporter: 0, assignee: 0, comment: 0 },
				userId: match === 'auto' ? matched[0] : null,
				match
			};
			people.set(k, person);
		}
		person.uses[kind] += 1;
	};
	for (const r of valid) {
		use(r.assignee, 'assignee');
		use(r.reporter, 'reporter');
		for (const c of r.comments) use(c.author, 'comment');
	}
	const memberIds = new Set(members.map((m) => m.userId));

	const done = statuses.find((s) => s.key === 'done');
	const plan: IssueImportPlan = {
		issues: prepared.length,
		comments: valid.reduce((n, r) => n + r.comments.length, 0),
		firstNumber: numbers.length > 0 ? Math.min(...numbers) : p.nextIssueNumber,
		lastNumber: numbers.length > 0 ? Math.max(...numbers) : p.nextIssueNumber,
		renumbered,
		backlogProjects: [...new Set(valid.map((r) => r.key.replace(/-\d+$/, '')))].sort(),
		created: {
			statuses: newStatuses.map((s) => s.name),
			types: typeSet.created.map((t) => t.name),
			categories: categorySet.created.map((c) => c.name),
			milestones: milestoneSet.created.map((m) => m.name)
		},
		people: [...people.values()],
		users: users.map((u) => ({ ...u, member: u.role === 'admin' || memberIds.has(u.id) })),
		rowErrors: rowErrors.sort((a, b) => a.rowNumber - b.rowNumber),
		longTitles: valid.filter((r) => r.title.length > TITLE_MAX).map((r) => r.key),
		alreadyImported: valid
			.filter((r) => importedByKey.has(r.key))
			.map((r) => r.key)
			.sort(),
		extraColumns: [...new Set(valid.flatMap((r) => r.extra.map((x) => x.name)))]
	};
	return {
		plan,
		project: p,
		issues: prepared,
		newStatuses,
		newTypes: typeSet.created,
		newCategories: categorySet.created,
		newMilestones: milestoneSet.created,
		statusInsertAt: done ? done.position : Math.max(-1, ...statuses.map((s) => s.position)) + 1,
		typeNextPosition: Math.max(-1, ...types.map((t) => t.position)) + 1,
		renumberFrom
	};
}

export async function planIssueImport(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<IssueImportPlan> {
	authorize(ctx.actor, 'project:manage');
	const { rows } = parse(PlanInput, input);
	return (await buildImport(ctx, key, rows)).plan;
}

const raced = (label: string) =>
	`取り込み中に同じ名前の${label}が追加されたため、何も書き込んでいません。CSV を読み込み直してください`;
/** 一意インデックスの列（SQLite の「UNIQUE constraint failed: 表.列」に出る形）と、当たったときの文言 */
const CONFLICTS: [column: string, message: string][] = [
	['issue.backlog_key', '既に取り込んだ課題があります。CSV を読み込み直してください'],
	[
		'issue.number',
		'取り込み中に課題が起票されたため、何も書き込んでいません。CSV を読み込み直してください'
	],
	['issue_type.name', raced('種別')],
	['category.name', raced('カテゴリー')],
	['milestone.name', raced('マイルストーン')]
];

/**
 * batch が一意インデックスに当たったときの文言。検査と batch の間に、別の取り込みが済んだり
 * 管理者が同じ名前の種別などを足したりした場合。それ以外のエラーなら null
 */
function conflictMessage(e: unknown): string | null {
	for (let x = e; x; x = (x as { cause?: unknown }).cause) {
		const message = x instanceof Error ? x.message : String(x);
		const hit = CONFLICTS.find(([column]) => message.includes(column));
		if (hit) return hit[1];
	}
	return null;
}

export async function importIssues(
	ctx: AppContext,
	key: string,
	input: unknown
): Promise<IssueImportResult> {
	authorize(ctx.actor, 'project:manage');
	const { rows, people } = parse(ImportInput, input);
	const built = await buildImport(ctx, key, rows);
	const { plan, project: p, issues } = built;
	if (plan.alreadyImported.length > 0) {
		const shown = plan.alreadyImported.slice(0, 10).join('、');
		const more =
			plan.alreadyImported.length > 10 ? ` ほか ${plan.alreadyImported.length - 10} 件` : '';
		throw new AppError(
			'conflict',
			`既に取り込んだ課題があります: ${shown}${more}。取り込み済みの課題を除いた CSV を使ってください`
		);
	}
	if (issues.length === 0) throw new AppError('validation', '取り込める課題がありません');

	const users = new Map(plan.users.map((u) => [u.id, u]));
	const mapping = new Map<string, string | null>();
	for (const x of people) {
		if (x.userId && !users.has(x.userId)) {
			throw new AppError('validation', `対応先のユーザーが見つかりません（${x.name}）`);
		}
		mapping.set(personKey(x.name), x.userId);
	}
	let needsUnknown = false;
	const joins = new Set<string>();
	/** 対応付けた人の id。いなければ null（参加者でない人はプロジェクトに足す） */
	const userOf = (name: string): string | null => {
		const id = name ? (mapping.get(personKey(name)) ?? null) : null;
		if (id && !users.get(id)!.member) joins.add(id);
		return id;
	};

	const positionOf = await tailPositions(
		ctx.db,
		p.id,
		issues.map((it) => it.statusKey)
	);
	const csvIds = new Set(issues.map((it) => it.id));
	// 続きの番号は、確認の後に起票された課題とも重ならないよう、書き込む時点のプロジェクトの次の番号から振る。
	// 定数は自前の整数なので文に埋め込む（1 行あたりのバインド変数を増やさない）
	const renumberFrom = sql.raw(String(built.renumberFrom));
	let renumberedCount = 0;
	const issueValues = issues.map((it) => {
		const r = it.row;
		const reporter = userOf(r.reporter);
		const assignee = userOf(r.assignee);
		if (!reporter) needsUnknown = true;
		return {
			id: it.id,
			projectId: p.id,
			// Backlog の番号のままにできないものは、キー ID 順に続きから振る（挿入の順は親が先で、これとは別）
			number:
				it.number ??
				sql`max((select ${project.nextIssueNumber} from ${project} where ${project.id} = ${p.id}), ${renumberFrom}) + ${sql.raw(String(renumberedCount++))}`,
			title: clipTitle(r.title),
			description: composeDescription(r, {
				reporterName: reporter ? null : r.reporter || null,
				assigneeName: assignee ? null : r.assignee || null,
				parentKey: it.parentNote
			}),
			typeId: it.typeId,
			status: it.statusKey,
			resolution: it.resolution,
			priority: it.priority,
			assigneeIds: assignee ? [assignee] : [],
			parentId: it.parentId,
			reporterId: reporter ?? UNKNOWN_USER_ID,
			startDate: r.startDate || null,
			dueDate: r.dueDate || null,
			categoryIds: categoryIdsValue(p.id, it.categoryIds),
			milestoneId: it.milestoneId,
			backlogKey: r.key,
			position: positionOf(it.statusKey),
			createdAt: new Date(r.createdAt!),
			updatedAt: new Date(r.updatedAt ?? r.createdAt!)
		};
	});
	const commentValues = issues.flatMap((it) =>
		it.row.comments.map((c) => {
			const author = userOf(c.author);
			if (!author) needsUnknown = true;
			const at = new Date(c.at ?? it.row.createdAt!);
			return {
				id: uuidv7(),
				issueId: it.id,
				authorId: author ?? UNKNOWN_USER_ID,
				body: composeComment(c.body, author ? null : c.author || null),
				createdAt: at,
				updatedAt: at
			};
		})
	);

	const stmts = [];
	if (needsUnknown) stmts.push(unknownUserInsert(ctx.db));
	if (built.newStatuses.length > 0) {
		stmts.push(
			ctx.db
				.update(issueStatus)
				.set({ position: sql`${issueStatus.position} + ${built.newStatuses.length}` })
				.where(
					and(eq(issueStatus.projectId, p.id), gte(issueStatus.position, built.statusInsertAt))
				),
			...insertChunks(
				issueStatus,
				built.newStatuses.map((st, i) => ({
					projectId: p.id,
					key: st.key,
					name: st.name,
					color: 'gray' as const,
					position: built.statusInsertAt + i
				}))
			).map((part) => ctx.db.insert(issueStatus).values(part))
		);
	}
	if (built.newTypes.length > 0) {
		stmts.push(
			...insertChunks(
				issueType,
				built.newTypes.map((t, i) => ({
					id: t.id,
					projectId: p.id,
					name: t.name,
					color: 'gray' as const,
					position: built.typeNextPosition + i
				}))
			).map((part) => ctx.db.insert(issueType).values(part))
		);
	}
	if (built.newCategories.length > 0) {
		stmts.push(
			...insertChunks(
				category,
				built.newCategories.map((c) => ({ id: c.id, projectId: p.id, name: c.name }))
			).map((part) => ctx.db.insert(category).values(part))
		);
	}
	if (built.newMilestones.length > 0) {
		stmts.push(
			...insertChunks(
				milestone,
				built.newMilestones.map((m) => ({ id: m.id, projectId: p.id, name: m.name }))
			).map((part) => ctx.db.insert(milestone).values(part))
		);
	}
	if (joins.size > 0) {
		stmts.push(
			...insertChunks(
				projectMember,
				[...joins].map((userId) => ({ projectId: p.id, userId }))
			).map((part) => ctx.db.insert(projectMember).values(part).onConflictDoNothing())
		);
	}
	// 親課題を先に入れる（parent_id の外部キーのため）
	const parents = issueValues.filter((x) => !x.parentId || !csvIds.has(x.parentId));
	const children = issueValues.filter((x) => x.parentId && csvIds.has(x.parentId));
	for (const part of [...insertChunks(issue, parents), ...insertChunks(issue, children)]) {
		stmts.push(ctx.db.insert(issue).values(part));
	}
	for (const part of insertChunks(comment, commentValues)) {
		stmts.push(ctx.db.insert(comment).values(part));
	}
	stmts.push(
		ctx.db
			.update(project)
			.set({
				nextIssueNumber: sql`max(${project.nextIssueNumber}, ${renumberFrom}) + ${renumberedCount}`
			})
			.where(eq(project.id, p.id))
	);
	const range = ctx.db
		.select({ first: sql<number>`min(${issue.number})`, last: sql<number>`max(${issue.number})` })
		.from(issue)
		.where(inList(issue.id, [...csvIds]));

	let results;
	try {
		const [first, ...rest] = stmts;
		results = await ctx.db.batch([first, ...rest, range]);
	} catch (e) {
		const message = conflictMessage(e);
		if (message) throw new AppError('conflict', message);
		throw e;
	}
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const [{ first, last }] = results[results.length - 1] as { first: number; last: number }[];
	return {
		issues: issues.length,
		comments: commentValues.length,
		firstNumber: first,
		lastNumber: last,
		skipped: plan.rowErrors.length,
		created: {
			statuses: built.newStatuses.length,
			types: built.newTypes.length,
			categories: built.newCategories.length,
			milestones: built.newMilestones.length
		}
	};
}
