import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { user } from '$lib/server/db/schema';
import { can } from '$lib/server/authz';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import { renderMarkdown } from '$lib/server/markdown';
import {
	addComment,
	deleteComment,
	editComment,
	listComments
} from '$lib/server/services/comments';
import { deleteIssue, getIssue, updateIssue } from '$lib/server/services/issues';
import { listAssignableUsers } from '$lib/server/services/projects';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

function issueNumber(raw: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) error(404, 'Not found');
	return n;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	const number = issueNumber(params.number);
	return handleLoad(async () => {
		const { project, issue } = await getIssue(ctx, params.key, number);
		const [comments, assignees] = await Promise.all([
			listComments(ctx, params.key, number),
			listAssignableUsers(ctx.db, project.id)
		]);
		const assignable = [...assignees.map((u) => ({ ...u, disabled: false }))];
		if (issue.assigneeId && !assignable.some((u) => u.id === issue.assigneeId)) {
			const [cur] = await ctx.db
				.select({ id: user.id, name: user.name, role: user.role })
				.from(user)
				.where(eq(user.id, issue.assigneeId));
			if (cur) assignable.push({ ...cur, disabled: true });
		}
		const res = { reporterId: issue.reporterId, assigneeId: issue.assigneeId };
		const writable = !project.archivedAt;
		return {
			issue: { ...issue, descriptionHtml: renderMarkdown(issue.description) },
			comments: comments.map((c) => ({
				...c,
				html: renderMarkdown(c.body),
				canModify: writable && can(ctx.actor, 'comment:modify', { authorId: c.authorId })
			})),
			assignees: assignable,
			perms: {
				writable,
				edit: writable && can(ctx.actor, 'issue:edit', res),
				changeStatus: writable && can(ctx.actor, 'issue:changeStatus', res),
				assign: writable && can(ctx.actor, 'issue:assign', res),
				delete: writable && can(ctx.actor, 'issue:delete', res)
			}
		};
	});
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await updateIssue(appContext(locals), params.key, issueNumber(params.number), input);
			return { saved: true };
		});
	},
	delete: async ({ locals, params }) =>
		handleAction(async () => {
			await deleteIssue(appContext(locals), params.key, issueNumber(params.number));
			redirect(303, `/projects/${params.key}`);
		}),
	comment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await addComment(appContext(locals), params.key, issueNumber(params.number), input);
			return { commented: true };
		});
	},
	editComment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await editComment(
				appContext(locals),
				params.key,
				issueNumber(params.number),
				input.commentId ?? '',
				input
			);
		});
	},
	deleteComment: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await deleteComment(
				appContext(locals),
				params.key,
				issueNumber(params.number),
				input.commentId ?? ''
			);
		});
	}
};
