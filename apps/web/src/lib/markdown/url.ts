/** リンク先として出してよい URL か。`/` 始まり（`//` を除く）か http / https / mailto のみ */
export function isAllowedUrl(url: string): boolean {
	const u = url.trim();
	if (u.startsWith('/')) return !/^\/[\\/]/.test(u);
	try {
		return ['http:', 'https:', 'mailto:'].includes(new URL(u).protocol);
	} catch {
		return false;
	}
}

/**
 * 入力された URL をリンク先にする。スキームのないもの（`example.com` など）には https:// を付ける。
 * 使えない URL なら null
 */
export function normalizeLinkUrl(input: string): string | null {
	const u = input.trim();
	if (!u) return null;
	const url = /^[/#]/.test(u) || /^[a-z][a-z\d+.-]*:/i.test(u) ? u : `https://${u}`;
	return isAllowedUrl(url) ? url : null;
}
