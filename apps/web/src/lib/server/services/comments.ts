import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { REACTION_EMOJIS, type ReactionGroup } from '../../reactions';
import { comment, commentReaction, issue as issueTable, user } from '../db/schema';
import { AppError } from '../errors';
import { notify } from '../notifications';
import { parse } from '../validation';
import { linkAttachments } from './attachment-links';
import { assertNotDeleted, getIssue } from './issues';
import { assertWritable, requireProject } from './projects';

const BodyInput = v.object({
	body: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, 'コメントを入力してください'),
		v.maxLength(20_000, 'コメントは20,000文字以内で入力してください')
	)
});

/** 課題が存在しない場合は空配列（課題の存在確認は getIssue で行う）。 */
export async function listComments(ctx: AppContext, key: string, number: number) {
	const p = await requireProject(ctx, key);
	const ofIssue = and(eq(issueTable.projectId, p.id), eq(issueTable.number, number));
	const [rows, reactions] = await Promise.all([
		ctx.db
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
			.where(ofIssue)
			.orderBy(asc(comment.createdAt), asc(comment.id)),
		ctx.db
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
			.where(ofIssue)
			.orderBy(asc(commentReaction.createdAt), asc(commentReaction.userId))
	]);
	// 絵文字は最初に付いた順、人は付けた順に並べる
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
	await ctx.db.insert(comment).values({ id, issueId: issue.id, authorId: ctx.actor.id, body });
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
	await ctx.db.update(comment).set({ body }).where(eq(comment.id, c.id));
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

const ReactionInput = v.object({
	emoji: v.picklist(REACTION_EMOJIS, 'この絵文字ではリアクションできません')
});

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
