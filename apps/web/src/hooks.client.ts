import type { ClientInit } from '@sveltejs/kit/hooks';

/**
 * 開いたままの画面での書き込み（画面の関数の form・command）が、セッション切れ（別のタブでのログアウト・
 * 無効化・期限切れ）で断られたら（401、hooks.server.ts）、ページごと読み込み直してサーバーにログイン画面へ
 * 転送させる。そのままでは「エラーが発生しました」とだけ出て、なぜ書けないのかわからない。
 * 読み込み（GET）の 401 は、遷移の途中なら +layout.svelte が読み込み直す。60 秒ごとの未読数の取り直しの
 * ような裏の読み込みでは、入力中の内容を消さないよう読み込み直さない
 */
export const init: ClientInit = () => {
	const nativeFetch = window.fetch;
	window.fetch = async (input, init) => {
		const res = await nativeFetch(input, init);
		if (
			res.status === 401 &&
			init?.method === 'POST' &&
			new URL(res.url).pathname.startsWith('/_app/remote/')
		) {
			location.reload();
			// 読み込み直すまで、呼び出し元にエラーを返さない（エラーの通知を出さない）
			return new Promise<Response>(() => {});
		}
		return res;
	};
};
