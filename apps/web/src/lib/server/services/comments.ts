import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { comment, issue as issueTable, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';
import { getIssue } from './issues';
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
		.where(and(eq(issueTable.projectId, p.id), eq(issueTable.number, number)))
		.orderBy(asc(comment.createdAt), asc(comment.id));
}

export async function addComment(
	ctx: AppContext,
	key: string,
	number: number,
	input: unknown
): Promise<void> {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	authorize(ctx.actor, 'comment:create');
	const { body } = parse(BodyInput, input);
	await ctx.db
		.insert(comment)
		.values({ id: uuidv7(), issueId: issue.id, authorId: ctx.actor.id, body });
}

async function findOwnedComment(ctx: AppContext, key: string, number: number, commentId: string) {
	const { project, issue } = await getIssue(ctx, key, number);
	assertWritable(project);
	const [c] = await ctx.db
		.select()
		.from(comment)
		.where(and(eq(comment.id, commentId), eq(comment.issueId, issue.id)));
	if (!c) throw new AppError('not_found', 'コメントが見つかりません');
	authorize(ctx.actor, 'comment:modify', { authorId: c.authorId });
	return c;
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
