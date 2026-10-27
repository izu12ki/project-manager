import { inArray } from 'drizzle-orm';
import * as v from 'valibot';
import { command, form, query } from '$app/server';
import { attachmentUrl, isSafeImage } from '$lib/attachment-rules';
import { can } from '$lib/server/authz';
import { user } from '$lib/server/db/schema';
import { renderMarkdown } from '$lib/server/markdown';
import { getUnreadCount } from '$lib/notifications.remote';
import { remoteContext, runCommand, runForm, runQuery } from '$lib/server/remote-helpers';
import { deleteAttachment, listAttachments } from '$lib/server/services/attachments';
import {
	addComment,
	deleteComment,
	editComment,
	listComments
} from '$lib/server/services/comments';
import {
	listCategories,
	listIssueTypesOf,
	listMilestones,
	listStatusesOf
} from '$lib/server/services/issue-fields';
import {
	getIssue,
	listChildIssues,
	listIssueChanges,
	listIssues,
	updateIssue
} from '$lib/server/services/issues';
import { markIssueRead } from '$lib/server/services/notifications';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';

const IssueRef = v.object({
	key: v.string(),
	number: v.pipe(v.number(), v.integer(), v.minValue(1))
});

const IssueRefFields = IssueRef.entries;
const opt = v.optional(v.string());

export const getIssueDetail = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const p = await requireProject(ctx, key);
		const { project, issue } = await getIssue(ctx, key, number);
		const [assignees, statuses, issueTypes, categories, milestones, children, issues] =
			await Promise.all([
				listAssignableUsers(ctx.db, p.id),
				listStatusesOf(ctx.db, p.id),
				listIssueTypesOf(ctx.db, p.id),
				listCategories(ctx, key),
				listMilestones(ctx, key),
				listChildIssues(ctx, key, issue.id),
				listIssues(ctx, key)
			]);
		const assignable = assignees.map((u) => ({ ...u, disabled: false }));
		// 無効化・脱退した人が担当のままなら、選択肢に残して外せるようにする
		const former = issue.assigneeIds.filter((id) => !assignable.some((u) => u.id === id));
		if (former.length > 0) {
			const rows = await ctx.db
				.select({ id: user.id, name: user.name, role: user.role })
				.from(user)
				.where(inArray(user.id, former));
			assignable.push(...rows.map((u) => ({ ...u, disabled: true })));
		}
		const res = { reporterId: issue.reporterId };
		// 削除した課題は閲覧だけできる
		const writable = !project.archivedAt && !issue.deletedAt;
		return {
			issue: { ...issue, descriptionHtml: renderMarkdown(issue.description) },
			assignees: assignable,
			statuses,
			issueTypes,
			categories,
			// 完了済みは選択肢から外す。ただし現在設定されているものは残す
			milestones: milestones.filter((m) => !m.completedAt || m.id === issue.milestoneId),
			children,
			// 子課題は 1 階層までなので、親にできるのは子課題でない課題だけ。子課題を持つ課題は親を設定できない
			parentCandidates:
				children.length > 0
					? []
					: issues
							.filter((i) => !i.parentId && i.id !== issue.id)
							.map((i) => ({ number: i.number, title: i.title })),
			perms: {
				writable,
				edit: writable && can(ctx.actor, 'issue:edit', res),
				changeStatus: writable && can(ctx.actor, 'issue:changeStatus', res),
				assign: writable && can(ctx.actor, 'issue:assign', res),
				delete: writable && can(ctx.actor, 'issue:delete', res)
			}
		};
	});
});

export const getComments = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const [{ project, issue }, comments] = await Promise.all([
			getIssue(ctx, key, number),
			listComments(ctx, key, number)
		]);
		return comments.map((c) => ({
			...c,
			html: renderMarkdown(c.body),
			canModify:
				!project.archivedAt &&
				!issue.deletedAt &&
				can(ctx.actor, 'comment:modify', { authorId: c.authorId })
		}));
	});
});

export const getChanges = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(() => listIssueChanges(ctx, key, number));
});

export const getAttachments = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const [{ project, issue }, rows] = await Promise.all([
			getIssue(ctx, key, number),
			listAttachments(ctx, key, number)
		]);
		return rows.map((a) => ({
			...a,
			url: attachmentUrl(project.key, a.id),
			isImage: isSafeImage(a.contentType),
			canDelete:
				!project.archivedAt &&
				!issue.deletedAt &&
				can(ctx.actor, 'attachment:delete', { uploaderId: a.uploaderId })
		}));
	});
});

export const saveIssue = form(
	v.object({
		...IssueRefFields,
		title: opt,
		typeId: opt,
		resolution: opt,
		description: opt,
		status: opt,
		priority: opt,
		assigneeIds: v.optional(v.array(v.string())),
		parentNumber: opt,
		categoryId: opt,
		milestoneId: opt,
		startDate: opt,
		dueDate: opt
	}),
	({ key, number, ...input }) =>
		runForm(async () => {
			await updateIssue(remoteContext(), key, number, input);
			void getIssueDetail({ key, number }).refresh();
			void getChanges({ key, number }).refresh();
			void getAttachments({ key, number }).refresh();
			return { saved: true };
		})
);

export const postComment = form(
	v.object({ ...IssueRefFields, body: v.string() }),
	({ key, number, body }) =>
		runForm(async () => {
			await addComment(remoteContext(), key, number, { body });
			void getComments({ key, number }).refresh();
			void getAttachments({ key, number }).refresh();
		})
);

export const updateComment = form(
	v.object({ ...IssueRefFields, commentId: v.string(), body: v.string() }),
	({ key, number, commentId, body }) =>
		runForm(async () => {
			await editComment(remoteContext(), key, number, commentId, { body });
			void getComments({ key, number }).refresh();
			void getAttachments({ key, number }).refresh();
		})
);

export const removeComment = command(
	v.object({ ...IssueRefFields, commentId: v.string() }),
	({ key, number, commentId }) =>
		runCommand(async () => {
			await deleteComment(remoteContext(), key, number, commentId);
			void getComments({ key, number }).refresh();
		})
);

export const removeAttachment = command(
	v.object({ ...IssueRefFields, attachmentId: v.string() }),
	({ key, number, attachmentId }) =>
		runCommand(async () => {
			await deleteAttachment(remoteContext(), key, attachmentId);
			void getAttachments({ key, number }).refresh();
		})
);

export const readIssueNotifications = command(IssueRef, ({ key, number }) =>
	runCommand(async () => {
		await markIssueRead(remoteContext(), key, number);
		void getUnreadCount().refresh();
	})
);
