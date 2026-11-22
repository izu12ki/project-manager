import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// base path を使わない（ルートに置く）ので resolve() を通す意味がない。
			// eslint-plugin-svelte 3.24 で SvelteKit 3 も対象になり、初めて有効になったルール
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '$app/forms',
							importNames: ['enhance'],
							message: '二度押しを防ぐ #lib/forms.ts の enhance を使ってください'
						},
						{
							name: 'drizzle-orm',
							importNames: ['inArray'],
							message:
								'D1 はバインド変数が 100 個までなので、#lib/server/db/limits.ts の inList を使ってください'
						}
					]
				}
			]
		}
	},
	{
		// ラップする元として使う
		files: ['src/lib/forms.ts'],
		rules: { 'no-restricted-imports': 'off' }
	},
	{
		// Vitest は isolate: false（vite.config.ts）なので、モジュールの差し替えは後のテストファイルに残る
		files: ['**/*.test.ts'],
		rules: {
			'no-restricted-properties': [
				'error',
				...['mock', 'doMock'].map((property) => ({
					object: 'vi',
					property,
					message: 'ファイルをまたいで残るので vi.spyOn を使ってください'
				}))
			]
		}
	}
);
