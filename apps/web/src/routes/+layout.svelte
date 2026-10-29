<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { afterNavigate, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import { ChevronRight, FolderKanban, PanelLeft } from '@lucide/svelte';
	import AppSidebar from '#lib/components/AppSidebar.svelte';
	import NavProgress from '#lib/components/NavProgress.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import ImageLightbox from '#lib/components/ImageLightbox.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const isMobile = new MediaQuery('max-width: 767px');
	let sidebarOpen = $state(true);
	let mobileOpen = $state(false);
	afterNavigate(() => (mobileOpen = false));

	// データ取得後（DOM 更新直前）に呼ばれるので、待ち時間中に画面が固まることはない
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	function toggleSidebar() {
		if (isMobile.current) mobileOpen = !mobileOpen;
		else sidebarOpen = !sidebarOpen;
	}

	type Crumb = { label: string; href?: string };
	const crumbs = $derived.by((): Crumb[] => {
		const path = page.url.pathname;
		const home = { label: 'プロジェクト', href: '/' };
		if (path === '/admin/projects/new') return [home, { label: '新規プロジェクト' }];
		if (path.startsWith('/admin/users')) return [{ label: '管理' }, { label: 'ユーザー' }];
		if (path === '/account') return [{ label: 'アカウント' }];
		if (path === '/notifications') return [{ label: '通知' }];
		if (path === '/emoji') return [{ label: 'カスタム絵文字' }];
		const project = page.data.project as { key: string; name: string } | undefined;
		if (project) {
			const base = `/projects/${project.key}`;
			const pc = { label: project.name, href: base };
			const rest = path.slice(base.length);
			if (rest === '/board') return [home, pc, { label: 'ボード' }];
			if (rest === '/settings') return [home, pc, { label: '設定' }];
			if (rest === '/issues/new') return [home, pc, { label: '新規課題' }];
			const m = rest.match(/^\/issues\/(\d+)$/);
			if (m) return [home, pc, { label: `${project.key}-${m[1]}` }];
			return [home, pc, { label: '課題一覧' }];
		}
		return [{ label: 'プロジェクト' }];
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Project Manager</title>
</svelte:head>

<Toaster />
<ImageLightbox />
<NavProgress />

{#if data.user}
	<div class="shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
		{#if mobileOpen && isMobile.current}
			<div class="scrim" aria-hidden="true" onclick={() => (mobileOpen = false)}></div>
		{/if}
		<AppSidebar
			user={data.user}
			projects={data.projects}
			{mobileOpen}
			inert={isMobile.current && !mobileOpen}
		/>
		<div class="column">
			<header class="topbar">
				<button
					type="button"
					class="icon-btn"
					aria-label="サイドバーを開閉"
					aria-expanded={isMobile.current ? mobileOpen : sidebarOpen}
					onclick={toggleSidebar}
				>
					<PanelLeft />
				</button>
				<span class="divider"></span>
				<nav aria-label="パンくずリスト" class="crumbs">
					{#each crumbs as c, i (i)}
						{#if i > 0}<ChevronRight size={14} color="var(--muted-foreground)" />{/if}
						{#if c.href && i < crumbs.length - 1}
							<a href={c.href} class="crumb">{c.label}</a>
						{:else}
							<span
								class="crumb"
								class:current={i === crumbs.length - 1}
								aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span
							>
						{/if}
					{/each}
				</nav>
			</header>
			<main class="content">
				<div class="container">
					{@render children()}
				</div>
			</main>
		</div>
	</div>
{:else}
	<div class="auth">
		<div class="auth-theme"><ThemeToggle /></div>
		<main class="auth-inner">
			<div class="auth-brand">
				<span class="auth-logo"><FolderKanban size={16} /></span>プロジェクト管理
			</div>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.shell {
		display: flex;
		min-height: 100vh;
	}
	.scrim {
		position: fixed;
		inset: 0;
		background: var(--overlay);
		z-index: 39;
	}
	.column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.topbar {
		height: 48px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 16px;
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--card);
		view-transition-name: topbar;
	}
	.divider {
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--border);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.crumb {
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	a.crumb:hover,
	.crumb.current {
		color: var(--foreground);
	}
	.content {
		flex: 1;
		padding: 20px clamp(16px, 2.5vw, 32px) 96px;
	}
	.container {
		max-width: 1240px;
		margin: 0 auto;
		display: grid;
		gap: 24px;
	}
	/* 課題詳細ページは 2 カラムなので、大きい画面では幅を広く取る */
	@media (min-width: 1400px) {
		.container:has(:global(.detail:not(.sheet))) {
			max-width: 1440px;
		}
	}
	.auth {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		position: relative;
	}
	.auth-theme {
		position: absolute;
		top: 16px;
		right: 16px;
	}
	.auth-inner {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.auth-brand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-weight: 600;
		font-size: 0.9375rem;
	}
	.auth-logo {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		background: var(--primary);
		color: var(--primary-foreground);
		display: grid;
		place-items: center;
	}
	/* 認証画面のカード（各ページの .auth-card） */
	.auth-inner :global(.auth-card) {
		gap: 24px;
	}
	.auth-inner :global(.auth-head) {
		display: grid;
		gap: 6px;
		text-align: center;
	}
	.auth-inner :global(.auth-head h1) {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}
	.auth-inner :global(.auth-head p) {
		margin: 0;
		color: var(--muted-foreground);
	}
	.auth-inner :global(.auth-form) {
		display: grid;
		gap: 20px;
	}
</style>
