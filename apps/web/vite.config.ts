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
			alias: { $lib: 'src/lib' }
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
