import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { isSafeImage } from '#lib/attachment-rules.ts';
import {
	MAX_CUSTOM_EMOJI_BYTES,
	MAX_CUSTOM_EMOJI_NAME,
	customEmojiCode,
	customEmojiUrl,
	isValidEmojiName,
	normalizeEmojiName
} from '#lib/custom-emoji.ts';
import { authorize, can } from '../authz';
import type { AppContext } from '../context';
import { commentReaction, customEmoji, user } from '../db/schema';
import { AppError } from '../errors';
import { parse } from '../validation';
import { normalizeContentType } from './attachments';

const NameInput = v.object({
	name: v.pipe(
		v.string(),
		v.transform(normalizeEmojiName),
		v.minLength(1, '名前を入力してください'),
		v.check(
			(s) => Array.from(s).length <= MAX_CUSTOM_EMOJI_NAME,
			`名前は${MAX_CUSTOM_EMOJI_NAME}文字以内で入力してください`
		),
		v.check(isValidEmojiName, '名前に使えるのは文字・数字・_・- だけです')
	)
});

/** 名前順。canDelete は本人が登録したもの（管理者はすべて） */
export async function listCustomEmojis(ctx: AppContext) {
	const rows = await ctx.db
		.select({
			id: customEmoji.id,
			name: customEmoji.name,
			creatorId: customEmoji.creatorId,
			creatorName: user.name,
			createdAt: customEmoji.createdAt
		})
		.from(customEmoji)
		.innerJoin(user, eq(user.id, customEmoji.creatorId))
		.orderBy(asc(customEmoji.name));
	return rows.map((r) => ({
		...r,
		url: customEmojiUrl(r.id),
		canDelete: can(ctx.actor, 'emoji:delete', { creatorId: r.creatorId })
	}));
}

export async function findCustomEmojiByName(ctx: AppContext, name: string) {
	const [row] = await ctx.db
		.select({ id: customEmoji.id })
		.from(customEmoji)
		.where(eq(customEmoji.name, name));
	return row ?? null;
}

export async function addCustomEmoji(
	ctx: AppContext,
	input: { name: unknown; file: unknown }
): Promise<{ name: string }> {
	authorize(ctx.actor, 'emoji:create');
	const { name } = parse(NameInput, { name: input.name });
	const file = input.file;
	if (!(file instanceof File) || file.size === 0)
		throw new AppError('validation', '画像を選択してください');
	const contentType = normalizeContentType(file.type);
	if (!isSafeImage(contentType))
		throw new AppError('validation', 'PNG・JPEG・GIF・WebP の画像を選択してください');
	if (file.size > MAX_CUSTOM_EMOJI_BYTES)
		throw new AppError('validation', '画像は256KB以下にしてください');
	if (await findCustomEmojiByName(ctx, name))
		throw new AppError('conflict', `:${name}: はすでに登録されています`);

	const id = uuidv7();
	const r2Key = `emoji/${id}`;
	await ctx.bucket.put(r2Key, file, { httpMetadata: { contentType } });
	try {
		await ctx.db
			.insert(customEmoji)
			.values({ id, name, creatorId: ctx.actor.id, contentType, r2Key });
	} catch (e) {
		// 同時に同じ名前が登録された場合も一意制約で弾かれる
		await ctx.bucket.delete(r2Key);
		if (await findCustomEmojiByName(ctx, name))
			throw new AppError('conflict', `:${name}: はすでに登録されています`);
		throw e;
	}
	return { name };
}

/** 消した絵文字のリアクションも消す */
export async function deleteCustomEmoji(ctx: AppContext, id: string): Promise<void> {
	const [row] = await ctx.db.select().from(customEmoji).where(eq(customEmoji.id, id));
	if (!row) throw new AppError('not_found', 'カスタム絵文字が見つかりません');
	authorize(ctx.actor, 'emoji:delete', { creatorId: row.creatorId });
	await ctx.db.batch([
		ctx.db.delete(commentReaction).where(eq(commentReaction.emoji, customEmojiCode(row.name))),
		ctx.db.delete(customEmoji).where(eq(customEmoji.id, row.id))
	]);
	ctx.waitUntil(
		ctx.bucket.delete(row.r2Key).catch((e) => console.error('custom emoji delete failed', e))
	);
}

export async function openCustomEmoji(ctx: AppContext, id: string) {
	const [row] = await ctx.db.select().from(customEmoji).where(eq(customEmoji.id, id));
	const obj = row && (await ctx.bucket.get(row.r2Key));
	if (!row || !obj) throw new AppError('not_found', 'カスタム絵文字が見つかりません');
	return { contentType: row.contentType, body: obj.body };
}
