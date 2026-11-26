import { and, asc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import { inList } from '../db/limits';
import { uuidv7 } from 'uuidv7';
import {
	MAX_ATTACHMENT_BYTES,
	TOO_LARGE_MESSAGE,
	attachmentUrl,
	isSafeImage
} from '#lib/attachment-rules.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { attachment, issue as issueTable, user } from '../db/schema';
import { AppError } from '../errors';
import { getIssue, issueStateQuery } from './issues';
import { checkProjectAccess, ofProject, projectAccessRead } from './project-access';
import { assertWritable, requireProject, requireProjectById } from './projects';

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
		inList(
			attachment.id,
			rows.map((r) => r.id)
		)
	);
	await ctx.bucket.delete(rows.map((r) => r.r2Key));
}

/** 課題（issueId の条件で絞る）に紐付いた添付を古い順に。batch にも入れられる */
function attachmentsQuery(ctx: AppContext, ofIssue: SQL) {
	return ctx.db
		.select({
			id: attachment.id,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			uploaderId: attachment.uploaderId,
			uploaderName: user.name,
			createdAt: attachment.createdAt
		})
		.from(attachment)
		.innerJoin(user, eq(user.id, attachment.uploaderId))
		.where(ofIssue)
		.orderBy(asc(attachment.createdAt), asc(attachment.id));
}

/** 課題に紐付いた添付（説明・コメントの両方）を古い順に返す */
export async function listAttachments(ctx: AppContext, key: string, number: number) {
	const { issue } = await getIssue(ctx, key, number);
	return attachmentsQuery(ctx, eq(attachment.issueId, issue.id));
}

/**
 * 課題の詳細画面の添付欄に要るもの（プロジェクト・課題の削除日時・添付）。1 回の batch（D1 への 1 往復）で引く。
 * 参加していないプロジェクト・無い課題は not_found
 */
export async function getAttachmentRows(ctx: AppContext, key: string, number: number) {
	const of = ofProject(ctx.db, key);
	const [access, issues, attachments] = await ctx.readBatch([
		projectAccessRead(ctx, key),
		issueStateQuery(ctx.db, of, number),
		attachmentsQuery(
			ctx,
			inList(
				attachment.issueId,
				ctx.db
					.select({ id: issueTable.id })
					.from(issueTable)
					.where(and(of(issueTable.projectId), eq(issueTable.number, number)))
			)
		)
	]);
	const project = checkProjectAccess(ctx, access);
	const [issue] = issues;
	if (!issue) throw new AppError('not_found', '課題が見つかりません');
	return { project, issue, attachments };
}

/**
 * 添付と、その添付のプロジェクト（参加者でなければ not_found）。URL のキーではなく添付の ID で引く。
 * プロジェクトのキーを変えても、本文やコメントに貼った古いキーのリンクが切れないようにするため
 */
async function findAttachment(ctx: AppContext, id: string) {
	const [row] = await ctx.db.select().from(attachment).where(eq(attachment.id, id));
	if (!row) throw new AppError('not_found', '添付ファイルが見つかりません');
	return { project: await requireProjectById(ctx, row.projectId), row };
}

export async function openAttachment(ctx: AppContext, id: string) {
	const { row } = await findAttachment(ctx, id);
	const obj = await ctx.bucket.get(row.r2Key);
	if (!obj) throw new AppError('not_found', '添付ファイルが見つかりません');
	return { row, body: obj.body };
}

export async function deleteAttachment(ctx: AppContext, id: string): Promise<void> {
	const { project: p, row } = await findAttachment(ctx, id);
	assertWritable(p);
	authorize(ctx.actor, 'attachment:delete', { uploaderId: row.uploaderId });
	await ctx.db.delete(attachment).where(eq(attachment.id, row.id));
	ctx.waitUntil(
		ctx.bucket.delete(row.r2Key).catch((e) => console.error('attachment delete failed', e))
	);
}

/** RFC 5987 の filename* 用。encodeURIComponent が残す ' ( ) * も符号化する */
function encodeFilename(name: string): string {
	return encodeURIComponent(name).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

/** 安全な画像だけインライン表示し、それ以外は種類を伏せて必ずダウンロードさせる */
export function downloadHeaders(row: { filename: string; contentType: string }): Headers {
	const image = isSafeImage(row.contentType);
	return new Headers({
		'Content-Type': image ? row.contentType : 'application/octet-stream',
		'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeFilename(row.filename)}`,
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': 'private, max-age=3600'
	});
}
