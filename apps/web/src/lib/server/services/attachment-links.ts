import { and, eq, isNull } from 'drizzle-orm';
import { inList } from '../db/limits';
import { PROJECT_KEY_PATTERN } from '#lib/project-key.ts';
import type { AppContext } from '../context';
import { attachment } from '../db/schema';

const ATTACHMENT_REF = new RegExp(
	`/projects/${PROJECT_KEY_PATTERN}/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
	'g'
);

/** 本文中の添付 URL から添付 ID を重複なく取り出す */
export function referencedAttachmentIds(body: string): string[] {
	return [...new Set(Array.from(body.matchAll(ATTACHMENT_REF), (m) => m[1]))];
}

/**
 * 本文で参照している添付のうち、同じプロジェクトの本人の仮置きだけを課題（とコメント）に紐付ける。
 * 他人の添付や紐付き済みの添付は変更しない。
 */
export async function linkAttachments(
	ctx: AppContext,
	target: { projectId: string; issueId: string; commentId?: string },
	body: string
): Promise<void> {
	const q = linkAttachmentsQuery(ctx, target, body);
	if (q) await q;
}

/** linkAttachments の更新文。参照がなければ null。一括処理で db.batch に入れるために使う */
export function linkAttachmentsQuery(
	ctx: AppContext,
	target: { projectId: string; issueId: string; commentId?: string },
	body: string
) {
	const ids = referencedAttachmentIds(body);
	if (ids.length === 0) return null;
	return ctx.db
		.update(attachment)
		.set({ issueId: target.issueId, commentId: target.commentId ?? null })
		.where(
			and(
				inList(attachment.id, ids),
				eq(attachment.projectId, target.projectId),
				isNull(attachment.issueId),
				eq(attachment.uploaderId, ctx.actor.id)
			)
		);
}
