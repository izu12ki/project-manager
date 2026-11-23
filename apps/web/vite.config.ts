import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

// SvelteKit の runtime/server/sourcemaps.js はモジュールの評価時に node:fs・node:url・node:path・node:module を読み込む。
// Worker の起動（グローバルスコープ）でその分の CPU を使うので、エラーのスタックを直すとき（fix_stack_trace の初回）まで遅らせる
const KIT_SOURCEMAPS_EAGER = `const fs = globalThis.process?.getBuiltinModule?.('node:fs');
const url = globalThis.process?.getBuiltinModule?.('node:url');
const path = globalThis.process?.getBuiltinModule?.('node:path');
const module = globalThis.process?.getBuiltinModule?.('node:module');

const cwd = globalThis.process?.cwd?.();

/** @type {(file: string) => string} */
const relative = cwd ? (file) => path.relative(cwd, file) : (file) => file;`;
const KIT_SOURCEMAPS_LAZY = `let fs, url, path, module, cwd, relative;
let builtins_loaded = false;
function load_builtins() {
	if (builtins_loaded) return;
	builtins_loaded = true;
	fs = globalThis.process?.getBuiltinModule?.('node:fs');
	url = globalThis.process?.getBuiltinModule?.('node:url');
	path = globalThis.process?.getBuiltinModule?.('node:path');
	module = globalThis.process?.getBuiltinModule?.('node:module');
	cwd = globalThis.process?.cwd?.();
	relative = cwd ? (file) => path.relative(cwd, file) : (file) => file;
}`;
const KIT_FIX_STACK_TRACE = 'export let fix_stack_trace = (error) => {';

function lazyKitSourcemaps(): Plugin {
	return {
		name: 'lazy-kit-sourcemaps',
		transform: {
			filter: { id: /[\\/]@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]server[\\/]sourcemaps\.js$/ },
			handler(code) {
				if (!code.includes(KIT_SOURCEMAPS_EAGER) || !code.includes(KIT_FIX_STACK_TRACE)) {
					this.warn('sourcemaps.js が変わったので、node: モジュールの読み込みを遅らせられない');
					return;
				}
				return code
					.replace(KIT_SOURCEMAPS_EAGER, KIT_SOURCEMAPS_LAZY)
					.replace(KIT_FIX_STACK_TRACE, `${KIT_FIX_STACK_TRACE}\n\tload_builtins();`);
			}
		}
	};
}

export default defineConfig({
	plugins: [
		lazyKitSourcemaps(),
		tailwindcss(),
		sveltekit({
			experimental: { remoteFunctions: true },
			compilerOptions: {
				experimental: { async: true },
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// スクリプトは自サイトと、SvelteKit がページごとに nonce を付けたインラインのものだけ実行する
			csp: {
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// style 属性（style: ディレクティブ・エディタ・ドラッグ）が多く、nonce では許せないので inline を許す
					'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
					'font-src': ['self', 'https://fonts.gstatic.com'],
					// Markdown には外部の画像も書ける。blob: は絵文字登録のプレビュー
					'img-src': ['self', 'data:', 'blob:', 'https:'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					// ほかのサイトのフレームには埋め込ませない（クリックジャッキング対策）
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		// 実行時間の大半がファイルごとのモジュール再 import だったので、ファイル間でモジュールを共有する。
		// テストはモジュールレベルの状態に依存しないこと。vi.mock は後のファイルに残るので ESLint で禁止している
		isolate: false,
		include: ['src/**/*.test.ts']
	}
});
