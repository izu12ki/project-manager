import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { inList } from '../db/limits';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { AppContext } from '../context';
import {
	category,
	issue,
	issueStatus,
	issueType,
	milestone,
	project,
	projectMember,
	user
} from '../db/schema';
import { AppError } from '../errors';
import type { AssigneeRef } from './issues';
import type { ProjectRow } from './projects';

const parent = alias(issue, 'parent');
const reporter = alias(user, 'reporter');
const deleter = alias(user, 'deleter');

/**
 * 課題の詳細画面に要る行をまとめて引く。
 * DB（D1）への 1 往復ごとに待ち時間と CPU 時間がかかるので、プロジェクトの ID を待たずに引けるよう
 * プロジェクトキーの副問い合わせで絞り、1 回の batch（1 往復）で送る。担当者名だけは
 * 課題と子課題の担当者 ID が分かってから 1 往復で引く。
 */
export async function getIssueDetailRows(ctx: AppContext, key: string, number: number) {
	const { db } = ctx;
	const projectId = db.select({ id: project.id }).from(project).where(eq(project.key, key));
	const ofProject = (col: SQLiteColumn) => inList(col, projectId);
	const [
		projectRows,
		issueRows,
		children,
		assignable,
		statuses,
		issueTypes,
		categories,
		milestones
	] = await db.batch([
		// requireProject と同じ判定に使う（参加者か管理者でなければ見せない）
		db
			.select({ project, memberId: projectMember.userId })
			.from(project)
			.leftJoin(
				projectMember,
				and(eq(projectMember.projectId, project.id), eq(projectMember.userId, ctx.actor.id))
			)
			.where(eq(project.key, key)),
		db
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
			.where(and(ofProject(issue.projectId), eq(issue.number, number))),
		// 子課題（番号順）。削除したものは除く
		db
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
					ofProject(issue.projectId),
					inList(
						issue.parentId,
						db
							.select({ id: parent.id })
							.from(parent)
							.where(and(ofProject(parent.projectId), eq(parent.number, number)))
					),
					isNull(issue.deletedAt)
				)
			)
			.orderBy(asc(issue.number)),
		// listAssignableUsers と同じ（有効な管理者と参加者）
		db
			.select({ id: user.id, name: user.name, role: user.role })
			.from(user)
			.where(
				and(
					isNull(user.disabledAt),
					or(
						eq(user.role, 'admin'),
						inList(
							user.id,
							db
								.select({ id: projectMember.userId })
								.from(projectMember)
								.where(ofProject(projectMember.projectId))
						)
					)
				)
			)
			.orderBy(asc(user.name)),
		db
			.select({ key: issueStatus.key, name: issueStatus.name, color: issueStatus.color })
			.from(issueStatus)
			.where(ofProject(issueStatus.projectId))
			.orderBy(asc(issueStatus.position), asc(issueStatus.createdAt)),
		db
			.select()
			.from(issueType)
			.where(ofProject(issueType.projectId))
			.orderBy(asc(issueType.position), asc(issueType.createdAt)),
		db
			.select()
			.from(category)
			.where(ofProject(category.projectId))
			.orderBy(asc(category.createdAt), asc(category.id)),
		db
			.select()
			.from(milestone)
			.where(ofProject(milestone.projectId))
			.orderBy(
				sql`${milestone.releaseDate} is null`,
				asc(milestone.releaseDate),
				asc(milestone.name)
			)
	]);

	const [p] = projectRows;
	if (!p || (ctx.actor.role !== 'admin' && !p.memberId)) {
		throw new AppError('not_found', 'プロジェクトが見つかりません');
	}
	const [row] = issueRows;
	if (!row) throw new AppError('not_found', '課題が見つかりません');

	// 課題と子課題の担当者の名前。無効化・脱退した人も、担当のままなら名前を出す
	const ids = [...new Set([row.issue, ...children].flatMap((i) => i.assigneeIds))];
	const people =
		ids.length === 0
			? []
			: await db
					.select({ id: user.id, name: user.name, role: user.role })
					.from(user)
					.where(inList(user.id, ids));
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
		project: p.project as ProjectRow,
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
