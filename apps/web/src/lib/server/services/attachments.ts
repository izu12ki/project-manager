import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
	MAX_ATTACHMENT_BYTES,
	TOO_LARGE_MESSAGE,
	attachmentUrl,
	isSafeImage
} from '$lib/attachment-rules';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { attachment } from '../db/schema';
import { AppError } from '../errors';
import { assertWritable, requireProject } from './projects';

/** 仮置きのまま残す期間 */
const STALE_MS = 24 * 60 * 60 * 1000;

export interface UploadResult {
	id: string;
	url: string;
	filename: string;
	isImage: boolean;
}

/** パス区切り・制御文字を _ にし、255 文字（コードポイント）以内にする */
export function sanitizeFilename(name: string): string {
	// eslint-disable-next-line no-control-regex -- 制御文字を除くための範囲指定
	const cleaned = name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
	return Array.from(cleaned || 'file')
		.slice(0, 255)
		.join('');
}

export function normalizeContentType(type: string): string {
	return type.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

export async function uploadAttachment(
	ctx: AppContext,
	key: string,
	file: File
): Promise<UploadResult> {
	const p = await requireProject(ctx, key);
	assertWritable(p);
	authorize(ctx.actor, 'attachment:create');
	if (file.size === 0) throw new AppError('validation', '空のファイルは添付できません');
	if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError('validation', TOO_LARGE_MESSAGE);

	const id = uuidv7();
	const r2Key = `${p.id}/${id}`;
	const filename = sanitizeFilename(file.name);
	const contentType = normalizeContentType(file.type);
	await ctx.db.insert(attachment).values({
		id,
		projectId: p.id,
		uploaderId: ctx.actor.id,
		filename,
		contentType,
		size: file.size,
		r2Key
	});
	try {
		// ReadableStream だと R2 が長さを要求するので、File（Blob）のまま渡す
		await ctx.bucket.put(r2Key, file, { httpMetadata: { contentType } });
	} catch (e) {
		await ctx.db.delete(attachment).where(eq(attachment.id, id));
		throw e;
	}
	ctx.waitUntil(purgeStaleUploads(ctx).catch((e) => console.error('attachment purge failed', e)));
	return { id, url: attachmentUrl(p.key, id), filename, isImage: isSafeImage(contentType) };
}

/** 本人の、24 時間を過ぎた仮置きを行・R2 とも削除する */
export async function purgeStaleUploads(ctx: AppContext): Promise<void> {
	const rows = await ctx.db
		.select({ id: attachment.id, r2Key: attachment.r2Key })
		.from(attachment)
		.where(
			and(
				eq(attachment.uploaderId, ctx.actor.id),
				isNull(attachment.issueId),
				lt(attachment.createdAt, new Date(Date.now() - STALE_MS))
			)
		);
	if (rows.length === 0) return;
	await ctx.db.delete(attachment).where(
		inArray(
			attachment.id,
			rows.map((r) => r.id)
		)
	);
	await ctx.bucket.delete(rows.map((r) => r.r2Key));
}
