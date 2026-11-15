/** プロジェクトのアイコン画像の上限（1MB）。ちょうどは可 */
export const MAX_PROJECT_ICON_BYTES = 1024 * 1024;

/** 画像ごとに id が変わるので、同じ URL の画像は変わらない */
export function projectIconUrl(id: string): string {
	return `/project-icons/${id}`;
}
