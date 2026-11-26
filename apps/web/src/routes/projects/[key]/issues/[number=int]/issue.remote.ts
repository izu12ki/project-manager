import * as v from 'valibot';
import { command, form, query } from '$app/server';
import { attachmentUrl, isSafeImage } from '#lib/attachment-rules.ts';
import { can } from '#lib/server/authz.ts';
import { renderMarkdown } from '#lib/markdown/render.ts';
import { getUnreadCount } from '#lib/notifications.remote.ts';
import { remoteContext, runCommand, runForm, runQuery } from '#lib/server/remote-helpers.ts';
import { deleteAttachment, getAttachmentRows } from '#lib/server/services/attachments.ts';
import {
	addComment,
	deleteComment,
	editComment,
	getCommentRows,
	toggleReaction
} from '#lib/server/services/comments.ts';
import { getIssueDetailRows } from '#lib/server/services/issue-detail.ts';
import {
	listIssueChanges,
	listParentCandidates,
	updateIssue
} from '#lib/server/services/issues.ts';
import { markIssueRead } from '#lib/server/services/notifications.ts';
import { visibleProjectKeys } from '#lib/server/services/projects.ts';

const IssueRef = v.object({
	key: v.string(),
	number: v.pipe(v.number(), v.integer(), v.minValue(1))
});

const IssueRefFields = IssueRef.entries;
const opt = v.optional(v.string());

export const getIssueDetail = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		// 同時に呼んで、詳細と同じ読み取りの batch（DB への 1 往復）に入れる
		const [
			{ project, issue, children, assignees, statuses, issueTypes, categories, milestones },
			projectKeys
		] = await Promise.all([getIssueDetailRows(ctx, key, number), visibleProjectKeys(ctx)]);
		const res = { reporterId: issue.reporterId };
		// 削除した課題は閲覧だけできる
		const writable = !project.archivedAt && !issue.deletedAt;
		return {
			issue: { ...issue, descriptionHtml: renderMarkdown(issue.description, { projectKeys }) },
			// コメントの Markdown はブラウザで HTML にする（getComments）。課題キーをリンクにするのに使う
			projectKeys: [...projectKeys],
			assignees,
			statuses,
			issueTypes,
			categories,
			// 完了済みは選択肢から外す。ただし現在設定されているものは残す
			milestones: milestones.filter((m) => !m.completedAt || m.id === issue.milestoneId),
			children,
			perms: {
				writable,
				create: writable && can(ctx.actor, 'issue:create'),
				comment: writable && can(ctx.actor, 'comment:create'),
				edit: writable && can(ctx.actor, 'issue:edit', res),
				changeStatus: writable && can(ctx.actor, 'issue:changeStatus', res),
				assign: writable && can(ctx.actor, 'issue:assign', res),
				delete: writable && can(ctx.actor, 'issue:delete', res)
			}
		};
	});
});

/** 親課題の候補。プロジェクトの課題数だけ増えるので、詳細とは別に親課題の欄を使うときだけ取る */
export const getParentCandidates = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(() => listParentCandidates(ctx, key, number));
});

/**
 * コメントは Markdown のまま返し、ブラウザで HTML にする（IssueView）。サーバーで変換すると
 * 件数に比例して CPU 時間がかかり、コメントの多い課題で Workers Free の 10ms を超えるため
 */
export const getComments = query(IssueRef, ({ key, number }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const { project, issue, comments } = await getCommentRows(ctx, key, number);
		return comments.map((c) => ({
			...c,
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
		const { project, issue, attachments } = await getAttachmentRows(ctx, key, number);
		return attachments.map((a) => ({
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
		categoryIds: v.optional(v.array(v.string())),
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

export const reactToComment = command(
	v.object({ ...IssueRefFields, commentId: v.string(), emoji: v.string() }),
	({ key, number, commentId, emoji }) =>
		runCommand(async () => {
			await toggleReaction(remoteContext(), key, number, commentId, { emoji });
			void getComments({ key, number }).refresh();
		})
);

export const removeAttachment = command(
	v.object({ ...IssueRefFields, attachmentId: v.string() }),
	({ key, number, attachmentId }) =>
		runCommand(async () => {
			await deleteAttachment(remoteContext(), attachmentId);
			void getAttachments({ key, number }).refresh();
		})
);

export const readIssueNotifications = command(IssueRef, ({ key, number }) =>
	runCommand(async () => {
		await markIssueRead(remoteContext(), key, number);
		void getUnreadCount().refresh();
	})
);
