// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://project-manager-docs.hirano-i.workers.dev',
	integrations: [
		starlight({
			title: 'Project Manager',
			description: '受託開発会社と顧客が課題を共有する、セルフホスト型のプロジェクト管理ツール',
			logo: { src: './src/assets/logo.svg' },
			lastUpdated: true,
			customCss: ['./src/styles/custom.css'],
			defaultLocale: 'root',
			locales: { root: { label: '日本語', lang: 'ja' } },
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '必要なもの', slug: 'guides/requirements' },
						{ label: 'デプロイ手順', slug: 'guides/deploy' },
						{ label: 'アップデート', slug: 'guides/update' }
					]
				},
				{
					label: 'ガイド',
					items: [
						{ label: 'メール送信の設定', slug: 'guides/mail' },
						{ label: 'Slack 連携', slug: 'guides/slack' },
						{ label: 'タイムライン', slug: 'guides/timeline' },
						{ label: 'Backlog からの移行', slug: 'guides/backlog-import' }
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
