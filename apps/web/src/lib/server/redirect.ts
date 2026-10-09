const BASE = 'http://x';

/**
 * 同一オリジンの相対パスだけを許可する。制御文字とバックスラッシュは
 * ブラウザの URL 解析で除去/置換されて `//host` になり得るため、先に拒否する。
 * 最後に URL として解析し、origin が変わらないことを確認してから path+query+hash を返す。
 */
export function safeRedirect(target: string | null, fallback = '/'): string {
	if (!target || !target.startsWith('/')) return fallback;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(target)) return fallback;
	let url: URL;
	try {
		url = new URL(target, BASE);
	} catch {
		return fallback;
	}
	if (url.origin !== BASE) return fallback;
	return url.pathname + url.search + url.hash;
}
