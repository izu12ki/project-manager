/** カスタム絵文字の画像の上限（256KB）。ちょうどは可 */
export const MAX_CUSTOM_EMOJI_BYTES = 256 * 1024;
export const MAX_CUSTOM_EMOJI_NAME = 32;

/** 名前に使える文字。英数字・かな漢字などの文字と _ - */
const NAME_PATTERN = /^[\p{L}\p{M}\p{N}_-]+$/u;

export interface CustomEmoji {
	name: string;
	url: string;
}

/** 前後の空白と : を除き、小文字にそろえる。「:Party:」→「party」 */
export function normalizeEmojiName(raw: string): string {
	return raw
		.trim()
		.replace(/^:+|:+$/g, '')
		.normalize('NFC')
		.toLowerCase();
}

export function isValidEmojiName(name: string): boolean {
	return Array.from(name).length <= MAX_CUSTOM_EMOJI_NAME && NAME_PATTERN.test(name);
}

/** リアクションに保存する形。カスタム絵文字は「:name:」で持つ */
export const customEmojiCode = (name: string) => `:${name}:`;

/** 「:name:」ならその name、標準の絵文字なら null */
export function customEmojiName(emoji: string): string | null {
	const m = /^:(.+):$/u.exec(emoji);
	return m && isValidEmojiName(m[1]) ? m[1] : null;
}

export function customEmojiUrl(id: string): string {
	return `/emoji/${id}`;
}
