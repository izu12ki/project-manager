import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { isSafeImage } from '#lib/attachment-rules.ts';
import { MAX_PROJECT_ICON_BYTES } from '#lib/project-icon.ts';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { project } from '../db/schema';
import { AppError } from '../errors';
import { normalizeContentType } from './attachments';
import { forgetProject, requireProject, requireProjectById } from './projects';

const r2KeyOf = (id: string) => `project-icon/${id}`;

/** 画像を差し替える。古い画像は後で消す */
export async function setProjectIconImage(
	ctx: AppContext,
	key: string,
	file: unknown
): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	if (!(file instanceof File) || file.size === 0)
		throw new AppError('validation', '画像を選択してください');
	const contentType = normalizeContentType(file.type);
	if (!isSafeImage(contentType))
		throw new AppError('validation', 'PNG・JPEG・GIF・WebP の画像を選択してください');
	if (file.size > MAX_PROJECT_ICON_BYTES)
		throw new AppError('validation', '画像は1MB以下にしてください');

	const id = uuidv7();
	await ctx.bucket.put(r2KeyOf(id), file, { httpMetadata: { contentType } });
	try {
		await ctx.db
			.update(project)
			.set({ iconImageId: id, iconImageType: contentType })
			.where(eq(project.id, p.id));
	} catch (e) {
		await ctx.bucket.delete(r2KeyOf(id));
		throw e;
	}
	forgetProject(ctx, key);
	deleteLater(ctx, p.iconImageId);
}

export async function removeProjectIconImage(ctx: AppContext, key: string): Promise<void> {
	authorize(ctx.actor, 'project:manage');
	const p = await requireProject(ctx, key);
	if (!p.iconImageId) return;
	await ctx.db
		.update(project)
		.set({ iconImageId: null, iconImageType: null })
		.where(eq(project.id, p.id));
	forgetProject(ctx, key);
	deleteLater(ctx, p.iconImageId);
}

/** 参加していないプロジェクトの画像は not_found */
export async function openProjectIconImage(ctx: AppContext, id: string) {
	const [row] = await ctx.db
		.select({ projectId: project.id, contentType: project.iconImageType })
		.from(project)
		.where(eq(project.iconImageId, id));
	if (row) await requireProjectById(ctx, row.projectId);
	const obj = row && (await ctx.bucket.get(r2KeyOf(id)));
	if (!row?.contentType || !obj) throw new AppError('not_found', '画像が見つかりません');
	return { contentType: row.contentType, body: obj.body };
}

function deleteLater(ctx: AppContext, id: string | null) {
	if (!id) return;
	ctx.waitUntil(
		ctx.bucket.delete(r2KeyOf(id)).catch((e) => console.error('project icon delete failed', e))
	);
}
