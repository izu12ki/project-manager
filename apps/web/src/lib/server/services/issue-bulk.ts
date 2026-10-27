// 課題の一括起票・一括更新（API 用）。全件を検証してから 1 回の db.batch で書き込み、全件成功か全件失敗にする。
// DB への問い合わせ回数は件数によらず一定にする（Workers のサブリクエスト数の上限があるため）。
import { and, eq, inArray, sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { issue, issueChange, project } from '../db/schema';
import { AppError } from '../errors';
import { notifyBulk } from '../notifications';
import { parse } from '../validation';
import { linkAttachmentsQuery } from './attachment-links';
import {
	assertOneLevel,
	createEventsOf,
	describeChanges,
	loadFieldSets,
	updateEventsOf,
	loadFormerAssigneeNames,
	prepareCreate,
	preparePatch
} from './issue-input';
import { assertWritable, forgetProject, requireProject } from './projects';

export const BULK_MAX = 100;

const BulkInput = v.object(
	{
		items: v.pipe(
			v.array(v.unknown(), 'items は配列で指定してください'),
			v.minLength(1, '1 件以上指定してください'),
			v.maxLength(BULK_MAX, `1 回に ${BULK_MAX} 件までです`)
		)
	},
	'{ "items": [...] } の形で指定してください'
);

/**
 * 要素ごとに fn を呼び、入力エラーを items.<i>.<field> のキーに集めてからまとめて投げる。
 * 入力エラー以外（権限など）はその場で投げる。
 */
function collectItems<T>(items: unknown[], fn: (item: unknown, i: number) => T): T[] {
	const fields: Record<string, string[]> = {};
	let failed = 0;
	const out = items.map((item, i) => {
		try {
			return fn(item, i);
		} catch (e) {
			if (!(e instanceof AppError) || e.code !== 'validation') throw e;
			failed++;
			const entries = Object.entries(e.fields ?? {});
			if (entries.length === 0) fields[`items.${i}`] = [e.message];
			for (const [k, msgs] of entries) fields[`items.${i}.${k}`] = msgs;
			return undefined as T;
		}
	});
	if (failed > 0) {
		throw new AppError(
			'validation',
			`${failed} 件の課題に入力エラーがあります。何も書き込んでいません`,
			fields
		);
	}
	return out;
}

/** ステータスごとに、既存の末尾に続く position を要素の順に振る */
async function tailPositions(
	db: DB,
	projectId: string,
	statuses: string[]
): Promise<(status: string) => string> {
	const counts = new Map<string, number>();
	for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
	const rows =
		counts.size === 0
			? []
			: await db
					.select({ status: issue.status, max: sql<string | null>`max(${issue.position})` })
					.from(issue)
					.where(and(eq(issue.projectId, projectId), inArray(issue.status, [...counts.keys()])))
					.groupBy(issue.status);
	const max = new Map(rows.map((r) => [r.status, r.max]));
	const keys = new Map(
		[...counts].map(([s, n]) => [s, generateNKeysBetween(max.get(s) ?? null, null, n)])
	);
	return (status) => keys.get(status)!.shift()!;
}

function numberOf(item: unknown): number {
	const n = (item as { number?: unknown } | null)?.number;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
		const msg = 'number に課題番号（1 以上の整数）を指定してください';
		throw new AppError('validation', msg, { number: [msg] });
	}
	return n;
}

export async function bulkCreateIssues(
	ctx: AppContext,
	key: string,
	input: unknown,
	opts: { dryRun: boolean }
): Promise<{ numbers: number[] }> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const { items } = parse(BulkInput, input);
	const fields = await loadFieldSets(ctx.db, p.id);
	const values = collectItems(items, (item) => prepareCreate(ctx.actor, fields, item));
	if (opts.dryRun) return { numbers: [] };

	const positionOf = await tailPositions(
		ctx.db,
		p.id,
		values.map((val) => val.status)
	);
	const stmts = [];
	// 各要素について: 現在の nextIssueNumber を番号にして挿入し、その後 +1 する。バッチは 1 トランザクション。
	for (const val of values) {
		stmts.push(
			ctx.db.insert(issue).values({
				...val,
				projectId: p.id,
				number: sql`(select ${project.nextIssueNumber} from ${project} where ${project.id} = ${p.id})`,
				position: positionOf(val.status)
			})
		);
		stmts.push(
			ctx.db
				.update(project)
				.set({ nextIssueNumber: sql`${project.nextIssueNumber} + 1` })
				.where(eq(project.id, p.id))
		);
		const link = linkAttachmentsQuery(ctx, { projectId: p.id, issueId: val.id }, val.description);
		if (link) stmts.push(link);
	}
	const ids = values.map((val) => val.id);
	const select = ctx.db
		.select({ id: issue.id, number: issue.number })
		.from(issue)
		.where(inArray(issue.id, ids));
	// 振られた番号はバッチ末尾の select で引く（往復を増やさない）
	const [first, ...rest] = stmts;
	const results = await ctx.db.batch([first, ...rest, select]);
	forgetProject(ctx, key); // nextIssueNumber が変わった
	const rows = results[results.length - 1] as { id: string; number: number }[];
	const numberById = new Map(rows.map((r) => [r.id, r.number]));
	await notifyBulk(ctx, {
		project: p,
		items: values.map((val) => ({
			issue: { id: val.id, number: numberById.get(val.id)!, title: val.title },
			events: createEventsOf(val)
		}))
	});
	return { numbers: ids.map((id) => numberById.get(id)!) };
}

export async function bulkUpdateIssues(
	ctx: AppContext,
	key: string,
	input: unknown,
	opts: { dryRun: boolean }
): Promise<{ numbers: number[] }> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	const { items } = parse(BulkInput, input);
	const requested = items.map((item) => {
		try {
			return numberOf(item);
		} catch {
			return null;
		}
	});
	const wanted = [...new Set(requested.filter((n): n is number => n !== null))];
	const [fields, rows] = await Promise.all([
		loadFieldSets(ctx.db, p.id),
		ctx.db
			.select()
			.from(issue)
			.where(and(eq(issue.projectId, p.id), inArray(issue.number, wanted)))
	]);
	const byNumber = new Map(rows.map((r) => [r.number, r]));
	const seen = new Set<number>();
	const targets = collectItems(items, (item) => {
		const number = numberOf(item);
		const numberError = (msg: string) =>
			new AppError('validation', msg, { number: [`${msg}（number: ${number}）`] });
		if (seen.has(number)) throw numberError('同じ課題が複数回指定されています');
		seen.add(number);
		const cur = byNumber.get(number);
		if (!cur) throw numberError('課題が見つかりません');
		if (cur.deletedAt) throw numberError('削除された課題は変更できません');
		const { number: _, ...rest } = item as Record<string, unknown>;
		void _;
		return { cur, patch: preparePatch(ctx.actor, fields, cur, rest) };
	});
	assertOneLevel(fields, targets);
	const numbers = targets.map((t) => t.cur.number);
	if (opts.dryRun) return { numbers: [] };

	const changed = targets.filter((t) => Object.keys(t.patch).length > 0);
	if (changed.length === 0) return { numbers };
	const [positionOf, otherUsers] = await Promise.all([
		tailPositions(
			ctx.db,
			p.id,
			changed.flatMap((t) => (t.patch.status !== undefined ? [t.patch.status] : []))
		),
		loadFormerAssigneeNames(ctx.db, fields, changed)
	]);
	const stmts = [];
	for (const { cur, patch } of changed) {
		if (patch.status !== undefined) patch.position = positionOf(patch.status);
		stmts.push(ctx.db.update(issue).set(patch).where(eq(issue.id, cur.id)));
		const changes = describeChanges(fields, cur, patch, otherUsers);
		if (changes.length > 0) {
			stmts.push(
				ctx.db
					.insert(issueChange)
					.values({ id: uuidv7(), issueId: cur.id, actorId: ctx.actor.id, changes })
			);
		}
		if (patch.description !== undefined) {
			const link = linkAttachmentsQuery(
				ctx,
				{ projectId: p.id, issueId: cur.id },
				patch.description
			);
			if (link) stmts.push(link);
		}
	}
	const [first, ...rest] = stmts;
	await ctx.db.batch([first, ...rest]);
	await notifyBulk(ctx, {
		project: p,
		items: changed.map(({ cur, patch }) => ({
			issue: { id: cur.id, number: cur.number, title: patch.title ?? cur.title },
			events: updateEventsOf(cur, patch)
		}))
	});
	return { numbers };
}
