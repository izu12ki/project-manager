// 描画中に await する remote query を、サーバーでの描画では universal load（+page.ts）の時点で始める。
// SvelteKit はレイアウトの load が終わってから描画するので、描画中に呼ぶと D1 への 2 往復目になる
// （手元の計測で、本番の表示が 150ms ほど遅い）。load の時点ならレイアウトの load と同じ ctx.readBatch の
// batch（1 往復）に入り、描画中の呼び出しは、同じリクエストで同じ引数の query の結果を使う（remote query のキャッシュ）。
// 引数は描画中の呼び出しと同じにすること。違うと結果を使えず、1 往復ずつ増える
import { browser } from '$app/env';

type Started = { catch(onrejected: () => void): unknown };

/**
 * サーバーでの描画のときだけ、queries を始める。サイドバーの未読数はルートのレイアウトの load（+layout.server.ts）が始める。
 * ブラウザ（ハイドレーションと遷移）では何もしない。遷移では各 query をそれぞれ取りにいく。
 * 失敗は描画中の呼び出しが扱う（同じ結果を受け取る）ので、ここでは捨てる
 */
export function startOnServer(...queries: (() => Started)[]): void {
	if (browser) return;
	for (const start of queries) start().catch(() => {});
}
