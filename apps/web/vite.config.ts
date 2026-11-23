import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

// SvelteKit の runtime/server の一部はモジュールの評価時に node:fs・node:util などを読み込む。
// Worker の起動（グローバルスコープ）でその分の CPU を使うので、最初に使うときまで遅らせる。
// 置き換えは元と同じ行数にし、新しい関数はファイルの末尾に足す（元の行の位置が変わらないので、ソースマップをそのまま使える）
const KIT_LAZY_BUILTINS: { file: RegExp; replace: [string, string][]; append?: string }[] = [
	{
		// エラーのスタックを直すとき（fix_stack_trace の初回）に読み込む
		file: /[\\/]@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]server[\\/]sourcemaps\.js$/,
		replace: [
			[
				`const fs = globalThis.process?.getBuiltinModule?.('node:fs');
const url = globalThis.process?.getBuiltinModule?.('node:url');
const path = globalThis.process?.getBuiltinModule?.('node:path');
const module = globalThis.process?.getBuiltinModule?.('node:module');

const cwd = globalThis.process?.cwd?.();

/** @type {(file: string) => string} */
const relative = cwd ? (file) => path.relative(cwd, file) : (file) => file;`,
				`let fs;
let url;
let path;
let module;

let cwd;

/** @type {(file: string) => string} */
let relative;`
			],
			[
				'export let fix_stack_trace = (error) => {',
				'export let fix_stack_trace = (error) => { load_builtins();'
			]
		],
		append: `
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
}
`
	},
	{
		// リクエストのログを整形するとき（format_response の初回）に読み込む
		file: /[\\/]@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]server[\\/]internal\.js$/,
		replace: [
			[
				`const styleText =
	// eslint-disable-next-line n/prefer-global/process
	globalThis.process?.getBuiltinModule?.('node:util')?.styleText ??
	/** @type {(format: unknown, text: string) => string} */ ((_format, text) => text);`,
				`let style_text;
const styleText = (format, text) =>
	(style_text ??= globalThis.process?.getBuiltinModule?.('node:util')?.styleText ??
		((_format, text) => text))(format, text);`
			]
		]
	}
];

const lineCount = (s: string) => s.split('\n').length;
for (const { file, replace } of KIT_LAZY_BUILTINS) {
	for (const [from, to] of replace) {
		if (lineCount(from) !== lineCount(to)) throw new Error(`${file}: 置き換えの行数が元と違う`);
	}
}

function lazyKitBuiltins(): Plugin {
	return {
		name: 'lazy-kit-builtins',
		transform: {
			filter: { id: KIT_LAZY_BUILTINS.map((p) => p.file) },
			handler(code, id) {
				const patch = KIT_LAZY_BUILTINS.find((p) => p.file.test(id));
				if (!patch) return;
				if (!patch.replace.every(([from]) => code.includes(from))) {
					this.warn(`${id} が変わったので、node: モジュールの読み込みを遅らせられない`);
					return;
				}
				const out = patch.replace.reduce((acc, [from, to]) => acc.replace(from, to), code);
				// 元の行は位置が変わらず、足した行は末尾にだけあるので、それまでのソースマップをそのまま使う
				return { code: out + (patch.append ?? ''), map: null };
			}
		}
	};
}

export default defineConfig({
	plugins: [
		lazyKitBuiltins(),
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
