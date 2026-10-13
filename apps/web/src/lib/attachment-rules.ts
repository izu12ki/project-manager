/** 添付の上限（25MB）。ちょうどは可。 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = 'ファイルは25MB以下にしてください';

// ブラウザでインライン表示しても安全な画像。SVG はスクリプトを含められるので入れない
const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isSafeImage(contentType: string): boolean {
	return SAFE_IMAGE_TYPES.has(contentType.toLowerCase());
}

export function attachmentUrl(projectKey: string, id: string): string {
	return `/projects/${projectKey}/attachments/${id}`;
}

/** 本文に挿入する Markdown。ファイル名の [ ] \ はエスケープする */
export function markdownFor(r: { filename: string; url: string; isImage: boolean }): string {
	const label = r.filename.replace(/[\\[\]]/g, (c) => `\\${c}`);
	return `${r.isImage ? '!' : ''}[${label}](${r.url})`;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 貼り付けをアップロードとして扱うか。Excel・Word などはテキストと一緒に画像も載せるので、
 * テキストがあればブラウザ標準の貼り付けに任せる（スクリーンショットはテキストを持たない）。
 */
export function shouldUploadPaste(types: readonly string[], fileCount: number): boolean {
	return fileCount > 0 && !types.includes('text/plain');
}
