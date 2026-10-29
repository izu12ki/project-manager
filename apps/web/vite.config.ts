import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			experimental: { remoteFunctions: true },
			compilerOptions: {
				experimental: { async: true },
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			alias: { $lib: 'src/lib' },
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
