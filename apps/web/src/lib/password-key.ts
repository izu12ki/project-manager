// パスワードの鍵導出（重い計算）はブラウザで行い、サーバーは鍵の SHA-256 を照合するだけにする。
// Workers の無料プランの CPU 時間（1 リクエスト 10ms）に収めるため。DB が漏れたときに総当たりにかかる手間は、
// サーバーで同じ鍵導出をした場合と変わらない

export const PASSWORD_KEY_ITERATIONS = 600_000;

/** 鍵（passwordKey など）が届かなかったときの文言。サーバーの検証でも使う */
export const NO_PASSWORD_KEY =
	'パスワードを受け取れませんでした。JavaScript を有効にし、ページを再読み込みしてもう一度お試しください';

/**
 * パスワードから鍵（PBKDF2-SHA256、32 バイトを小文字の 16 進 64 文字）を作る。
 * ソルトはアプリ固有の文字列とメールアドレス（サーバーの EmailSchema と同じく trim して小文字）。
 * メールアドレスを変える機能を作るときは、ソルトが変わるので、パスワードも入力させて鍵を作り直すこと
 */
export async function derivePasswordKey(email: string, password: string): Promise<string> {
	const enc = new TextEncoder();
	const salt = enc.encode(`project-manager:password:${email.trim().toLowerCase()}`);
	const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_KEY_ITERATIONS },
		material,
		256
	);
	return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
