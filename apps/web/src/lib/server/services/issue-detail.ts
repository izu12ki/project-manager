import { and, asc, eq, isNull, sql, type Placeholder } from 'drizzle-orm';
import { inList } from '../db/limits';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { cachedRead } from '../db/cached-read';
import { issue, user } from '../db/schema';
import { AppError } from '../errors';
import { categoriesQuery, issueTypesQuery, milestonesQuery, statusesQuery } from './issue-fields';
import type { AssigneeRef } from './issues';
import {
	cachedByKey,
	checkProjectAccess,
	ofProject,
	projectAccessRead,
	type ProjectCond
} from './project-access';
import { assignableUsersQuery } from './projects';

const parent = alias(issue, 'parent');
const reporter = alias(user, 'reporter');
const deleter = alias(user, 'deleter');
/** 担当者名の副問い合わせで開く課題（この課題と子課題）と、子課題を探すためのこの課題 */
const assigned = alias(issue, 'assigned');
const self = alias(issue, 'self');

/** 課題 1 件と、親課題・報告者・削除した人の名前 */
function issueRowQuery(db: DB, of: ProjectCond, number: number | Placeholder) {
	return db
		.select({
			issue,
			// batch では同じ名前の列が重なるので（D1 の仕様）、join した表の列には別名を付ける
			parentNumber: sql<number | null>`${parent.number}`.as('parent_number'),
			parentTitle: sql<string | null>`${parent.title}`.as('parent_title'),
			reporterName: sql<string>`${reporter.name}`.as('reporter_name'),
			deletedByName: sql<string | null>`${deleter.name}`.as('deleted_by_name')
		})
		.from(issue)
		.leftJoin(parent, eq(issue.parentId, parent.id))
		.innerJoin(reporter, eq(issue.reporterId, reporter.id))
		.leftJoin(deleter, eq(issue.deletedBy, deleter.id))
		.where(and(of(issue.projectId), eq(issue.number, number)));
}

/** 子課題（番号順）。削除したものは除く */
function childrenQuery(db: DB, of: ProjectCond, number: number | Placeholder) {
	return db
		.select({
			id: issue.id,
			number: issue.number,
			title: issue.title,
			status: issue.status,
			assigneeIds: issue.assigneeIds
		})
		.from(issue)
		.where(
			and(
				of(issue.projectId),
				inList(
					issue.parentId,
					db
						.select({ id: parent.id })
						.from(parent)
						.where(and(of(parent.projectId), eq(parent.number, number)))
				),
				isNull(issue.deletedAt)
			)
		)
		.orderBy(asc(issue.number));
}

/** 課題と子課題（削除したものも含めてよい。名前を引くだけ）の担当者。無効化・脱退した人も含む */
function peopleQuery(db: DB, of: ProjectCond, number: number | Placeholder) {
	return db
		.select({ id: user.id, name: user.name, role: user.role })
		.from(user)
		.where(
			sql`${user.id} in (select j.value from ${issue} as ${assigned}, json_each(${assigned.assigneeIds}) as j
					where ${of(assigned.projectId)} and (${assigned.number} = ${number} or ${assigned.parentId} in ${db
						.select({ id: self.id })
						.from(self)
						.where(and(of(self.projectId), eq(self.number, number)))}))`
		);
}

// 組み立てを使い回す（db/cached-read.ts）
const byKeyAndNumber = <Q>(query: (db: DB, of: ProjectCond, number: Placeholder) => Q) => {
	const read = cachedRead(['key', 'number'], (db, p) => query(db, ofProject(db, p.key), p.number));
	return (db: DB, key: string, number: number) => read(db, { key, number });
};
/** 課題 1 件と、親課題・報告者・削除した人の名前。ctx.readBatch 用。課題の更新（issue-input.ts）でも使う */
export const issueRowRead = byKeyAndNumber(issueRowQuery);
const childrenOf = byKeyAndNumber(childrenQuery);
const peopleOf = byKeyAndNumber(peopleQuery);
const assignableOf = cachedByKey(assignableUsersQuery);
const statusesOf = cachedByKey(statusesQuery);
const issueTypesOf = cachedByKey(issueTypesQuery);
const categoriesOf = cachedByKey(categoriesQuery);
const milestonesOf = cachedByKey(milestonesQuery);

/**
 * 課題の詳細画面に要る行をまとめて引く。
 * DB（D1）への 1 往復ごとに待ち時間と CPU 時間がかかるので、プロジェクトの ID を待たずに引けるよう
 * プロジェクトキーの副問い合わせで絞り、1 回の batch（1 往復）で送る。担当者名も、課題と子課題の
 * assignee_ids を副問い合わせで開いて同じ batch で引く。
 */
export async function getIssueDetailRows(ctx: AppContext, key: string, number: number) {
	const { db } = ctx;
	const [
		access,
		issueRows,
		children,
		assignable,
		statuses,
		issueTypes,
		categories,
		milestones,
		people
	] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		issueRowRead(db, key, number),
		childrenOf(db, key, number),
		assignableOf(db, key),
		statusesOf(db, key),
		issueTypesOf(db, key),
		categoriesOf(db, key),
		milestonesOf(db, key),
		peopleOf(db, key, number)
	]);

	const project = checkProjectAccess(ctx, access);
	const [row] = issueRows;
	if (!row) throw new AppError('not_found', '課題が見つかりません');

	// 課題と子課題の担当者の名前。無効化・脱退した人も、担当のままなら名前を出す
	const byId = new Map(people.map((u) => [u.id, u]));
	const named = (assigneeIds: string[]): AssigneeRef[] =>
		assigneeIds.flatMap((id) => {
			const u = byId.get(id);
			return u ? [{ id, name: u.name }] : [];
		});

	// 無効化・脱退した人が担当のままなら、選択肢に残して外せるようにする
	const assignees = [
		...assignable.map((u) => ({ ...u, disabled: false })),
		...row.issue.assigneeIds.flatMap((id) => {
			const u = byId.get(id);
			return u && !assignable.some((a) => a.id === id) ? [{ ...u, disabled: true }] : [];
		})
	];

	return {
		project,
		issue: {
			...row.issue,
			assignees: named(row.issue.assigneeIds),
			parent:
				row.parentNumber === null ? null : { number: row.parentNumber, title: row.parentTitle! },
			reporterName: row.reporterName,
			deletedByName: row.deletedByName
		},
		children: children.map((c) => ({ ...c, assignees: named(c.assigneeIds) })),
		assignees,
		statuses,
		issueTypes,
		categories,
		milestones
	};
}
