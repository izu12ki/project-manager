import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { customEmojiName } from '../../custom-emoji';
import { REACTION_EMOJIS, type ReactionGroup } from '../../reactions';
import { comment, commentReaction, issue as issueTable, user } from '../db/schema';
import { AppError } from '../errors';
import { notify } from '../notifications';
import { parse } from '../validation';
import { linkAttachments } from './attachment-links';
import { findCustomEmojiByName } from './custom-emojis';
import { assertNotDeleted, getIssue, issueStateQuery } from './issues';
import {
	byProjectId,
	checkProjectAccess,
	ofProject,
	projectAccessQuery,
	type ProjectCond
} from './project-access';
import { assertWritable, requireProject } from './projects';

const BodyInput = v.object({
	body: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, 'コメントを入力してください'),
		v.maxLength(20_000, 'コメントは20,000文字以内で入力してください')
	)
});

/** 課題を絞る条件（プロジェクトと番号）。プロジェクトは ID でもキーの副問い合わせでもよい */
const ofIssue = (of: ProjectCond, number: number) =>
	and(of(issueTable.projectId), eq(issueTable.number, number));

function commentsQuery(ctx: AppContext, of: ProjectCond, number: number) {
	return ctx.db
		.select({
			id: comment.id,
			body: comment.body,
			authorId: comment.authorId,
			authorName: user.name,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt
		})
		.from(comment)
		.innerJoin(user, eq(user.id, comment.authorId))
		.innerJoin(issueTable, eq(issueTable.id, comment.issueId))
		.where(ofIssue(of, number))
		.orderBy(asc(comment.createdAt), asc(comment.id));
}

function reactionsQuery(ctx: AppContext, of: ProjectCond, number: number) {
	return ctx.db
		.select({
			commentId: commentReaction.commentId,
			emoji: commentReaction.emoji,
			userId: user.id,
			userName: user.name
		})
		.from(commentReaction)
		.innerJoin(user, eq(user.id, commentReaction.userId))
		.innerJoin(comment, eq(comment.id, commentReaction.commentId))
		.innerJoin(issueTable, eq(issueTable.id, comment.issueId))
		.where(ofIssue(of, number))
		.orderBy(asc(commentReaction.createdAt), asc(commentReaction.userId));
}

type CommentRow = Awaited<ReturnType<typeof commentsQuery>>[number];
type ReactionRow = Awaited<ReturnType<typeof reactionsQuery>>[number];

/** コメントにリアクションを付ける。絵文字は最初に付いた順、人は付けた順に並べる */
function withReactions(rows: CommentRow[], reactions: ReactionRow[]) {
	const byComment = new Map<string, ReactionGroup[]>();
	for (const r of reactions) {
		const groups = byComment.get(r.commentId) ?? [];
		byComment.set(r.commentId, groups);
		let g = groups.find((x) => x.emoji === r.emoji);
		if (!g) groups.push((g = { emoji: r.emoji, users: [] }));
		g.users.push({ id: r.userId, name: r.userName });
	}
	return rows.map((c) => ({ ...c, reactions: byComment.get(c.id) ?? [] }));
}

/** 課題が存在しない場合は空配列（課題の存在確認は getIssue で行う）。 */
export async function listComments(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	const of = byProjectId(p.id);
	const [rows, reactions] = await Promise.all([
		commentsQuery(ctx, of, number),
		reactionsQuery(ctx, of, number)
	]);
	return withReactions(rows, reactions);
}

/**
 * 課題の詳細画面のコメント欄に要るもの（プロジェクト・課題の削除日時・コメント）。1 回の batch（D1 への 1 往復）で引く。
 * 参加していないプロジェクト・無い課題は not_found
 */
export async function getCommentRows(ctx: AppContext, key: string, number: number) {
	const of = ofProject(ctx.db, key);
	const [access, issues, rows, reactions] = await ctx.db.batch([
		projectAccessQuery(ctx, key),
		issueStateQuery(ctx.db, of, number),
		commentsQuery(ctx, of, number),
		reactionsQuery(ctx, of, number)
	]);
	const project = checkProjectAccess(ctx, access);
	const [issue] = issues;
	if (!issue) throw new AppError('not_found', '課題が見つかりません');
	return { project, issue, comments: withReactions(rows, reactions) };
}

/** コメントの投稿・編集で、課題の更新日時（一覧の「更新日」）も進める。削除とリアクションでは進めない */
function touchIssue(ctx: AppContext, issueId: string) {
	return ctx.db.update(issueTable).set({ updatedAt: new Date() }).where(eq(issueTable.id, issueId));
}

export async function addComment(
	ctx: AppContext,
	key: string,
	number: number,
	input: unknown
): Promise<void> {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	assertNotDeleted(issue);
	authorize(ctx.actor, 'comment:create');
	const { body } = parse(BodyInput, input);
	const id = uuidv7();
	await ctx.db.batch([
		ctx.db.insert(comment).values({ id, issueId: issue.id, authorId: ctx.actor.id, body }),
		touchIssue(ctx, issue.id)
	]);
	await linkAttachments(ctx, { projectId: project.id, issueId: issue.id, commentId: id }, body);
	await notify(ctx, {
		project,
		issue: { id: issue.id, number: issue.number, title: issue.title },
		events: [{ kind: 'commented', commentId: id, body }]
	});
}

async function findOwnedComment(ctx: AppContext, key: string, number: number, commentId: string) {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	assertNotDeleted(issue);
	const [c] = await ctx.db
		.select()
		.from(comment)
		.where(and(eq(comment.id, commentId), eq(comment.issueId, issue.id)));
	if (!c) throw new AppError('not_found', 'コメントが見つかりません');
	authorize(ctx.actor, 'comment:modify', { authorId: c.authorId });
	return { ...c, projectId: project.id, project, issue };
}

export async function editComment(
	ctx: AppContext,
	key: string,
	number: number,
	commentId: string,
	input: unknown
): Promise<void> {
	const c = await findOwnedComment(ctx, key, number, commentId);
	const { body } = parse(BodyInput, input);
	await ctx.db.batch([
		ctx.db.update(comment).set({ body }).where(eq(comment.id, c.id)),
		touchIssue(ctx, c.issueId)
	]);
	await linkAttachments(ctx, { projectId: c.projectId, issueId: c.issueId, commentId: c.id }, body);
	await notify(ctx, {
		project: c.project,
		issue: { id: c.issue.id, number: c.issue.number, title: c.issue.title },
		events: [{ kind: 'mentions_added', commentId: c.id, before: c.body, after: body }]
	});
}

export async function deleteComment(
	ctx: AppContext,
	key: string,
	number: number,
	commentId: string
): Promise<void> {
	const c = await findOwnedComment(ctx, key, number, commentId);
	await ctx.db.delete(comment).where(eq(comment.id, c.id));
}

const ReactionInput = v.object({ emoji: v.string() });
const UNKNOWN_EMOJI = 'この絵文字ではリアクションできません';

/** 標準の絵文字か、登録済みのカスタム絵文字（:name:）だけを受け付ける */
async function assertReactable(ctx: AppContext, emoji: string): Promise<void> {
	if ((REACTION_EMOJIS as readonly string[]).includes(emoji)) return;
	const name = customEmojiName(emoji);
	if (!name || !(await findCustomEmojiByName(ctx, name)))
		throw new AppError('validation', UNKNOWN_EMOJI);
}

/** 自分のリアクションを付け外しする。付けていなければ付け、付けていれば外す */
export async function toggleReaction(
	ctx: AppContext,
	key: string,
	number: number,
	commentId: string,
	input: unknown
): Promise<void> {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	assertNotDeleted(issue);
	authorize(ctx.actor, 'comment:create');
	const { emoji } = parse(ReactionInput, input);
	await assertReactable(ctx, emoji);
	const [c] = await ctx.db
		.select({ id: comment.id })
		.from(comment)
		.where(and(eq(comment.id, commentId), eq(comment.issueId, issue.id)));
	if (!c) throw new AppError('not_found', 'コメントが見つかりません');
	const mine = and(
		eq(commentReaction.commentId, c.id),
		eq(commentReaction.userId, ctx.actor.id),
		eq(commentReaction.emoji, emoji)
	);
	const removed = await ctx.db
		.delete(commentReaction)
		.where(mine)
		.returning({ emoji: commentReaction.emoji });
	if (removed.length > 0) return;
	await ctx.db
		.insert(commentReaction)
		.values({ commentId: c.id, userId: ctx.actor.id, emoji })
		.onConflictDoNothing();
}
