// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://project-manager-docs.hirano-i.workers.dev',
	integrations: [
		starlight({
			title: 'Project Manager',
			defaultLocale: 'root',
			locales: { root: { label: '日本語', lang: 'ja' } },
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '必要なもの', slug: 'guides/requirements' },
						{ label: 'デプロイ手順', slug: 'guides/deploy' },
						{ label: 'メール送信の設定', slug: 'guides/mail' },
						{ label: 'Slack 連携', slug: 'guides/slack' },
						{ label: 'タイムライン', slug: 'guides/timeline' },
						{ label: 'アップデート', slug: 'guides/update' }
					]
				},
				{
					label: 'リファレンス',
					items: [
						{ label: '権限', slug: 'reference/permissions' },
						{ label: '環境変数', slug: 'reference/env' }
					]
				},
				{
					label: '開発に参加する',
					items: [
						{ label: 'ローカル開発', slug: 'contributing/local-dev' },
						{ label: 'このドキュメントの公開', slug: 'contributing/docs-hosting' }
					]
				}
			]
		})
	]
});
