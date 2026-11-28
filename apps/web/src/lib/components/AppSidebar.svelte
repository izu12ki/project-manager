<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Bell,
		ChevronsUpDown,
		CircleUser,
		FolderKanban,
		LayoutGrid,
		ListTodo,
		LogOut,
		Smile,
		Users
	} from '@lucide/svelte';
	import { ROLE_LABEL, colorFor } from '#lib/labels.ts';
	import { getUnreadCount } from '#lib/notifications.remote.ts';
	import ProjectIcon from './ProjectIcon.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	let {
		user,
		projects,
		inert = false,
		mobileOpen = false
	}: {
		user: { name: string; email: string; role: 'admin' | 'member' | 'guest' | 'viewer' };
		projects: {
			key: string;
			name: string;
			icon: string | null;
			iconImageId: string | null;
			color: string | null;
			archived: boolean;
		}[];
		inert?: boolean;
		mobileOpen?: boolean;
	} = $props();

	let menuOpen = $state(false);
	let footer = $state<HTMLElement>();

	const active = $derived(projects.filter((p) => !p.archived));
	const path = $derived(page.url.pathname);
	const isCurrent = (key: string) =>
		path === `/projects/${key}` || path.startsWith(`/projects/${key}/`);

	const unread = getUnreadCount();
	// 遷移ごとと、表示中は 60 秒ごとに取り直す。
	// 最初の表示（type 'enter'）では取り直さない。件数はサーバーでの描画でページに入っている（+layout.server.ts）。
	// 課題詳細へ移ったときは、IssueView の既読コマンドが既読にした後の件数を返すので取り直さない。
	// 同時に取り直すと、既読にする前の件数が後から届いてバッジを上書きすることがある
	afterNavigate(({ type, to }) => {
		menuOpen = false;
		if (type === 'enter') return;
		if (to?.route.id === '/projects/[key]/issues/[number=int]') return;
		void unread.refresh();
	});
	$effect(() => {
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') void unread.refresh();
		}, 60_000);
		return () => clearInterval(id);
	});
	const unreadLabel = $derived((unread.current ?? 0) > 99 ? '99+' : String(unread.current ?? 0));
</script>

<svelte:window
	onclick={(e) => {
		if (menuOpen && footer && !footer.contains(e.target as Node)) menuOpen = false;
	}}
	onkeydown={(e) => {
		if (menuOpen && e.key === 'Escape') menuOpen = false;
	}}
/>

<aside class="sidebar" data-sb data-mobile-open={mobileOpen || undefined} {inert}>
	<div style="padding: 8px">
		<a href="/" class="brand">
			<span class="brand-icon"><FolderKanban size={16} /></span>
			<span class="stack">
				<span style="font-weight: 600">プロジェクト管理</span>
				<span class="sub">ワークスペース</span>
			</span>
		</a>
	</div>

	<nav aria-label="メインメニュー" class="nav">
		<div class="group">
			<a href="/" class="item" aria-current={path === '/' ? 'page' : undefined}>
				<LayoutGrid size={16} class="muted-icon" />すべてのプロジェクト
			</a>
			<a href="/issues" class="item row" aria-current={path === '/issues' ? 'page' : undefined}>
				<ListTodo size={16} class="muted-icon" />自分の課題
			</a>
			<a
				href="/notifications"
				class="item row"
				aria-current={path === '/notifications' ? 'page' : undefined}
			>
				<Bell size={16} class="muted-icon" />通知
				{#if (unread.current ?? 0) > 0}
					<span class="badge" data-testid="unread-badge" aria-label={`未読 ${unreadLabel} 件`}>
						{unreadLabel}
					</span>
				{/if}
			</a>
			<a href="/emoji" class="item row" aria-current={path === '/emoji' ? 'page' : undefined}>
				<Smile size={16} class="muted-icon" />カスタム絵文字
			</a>
		</div>
		<div class="group">
			<div class="group-label">参加プロジェクト</div>
			{#each active as p (p.key)}
				<a
					href={`/projects/${p.key}`}
					class="item row proj"
					aria-current={isCurrent(p.key) ? 'page' : undefined}
				>
					<ProjectIcon project={p} size={32} />
					<span class="stack" style="min-width: 0">
						<span class="proj-name truncate">{p.name}</span>
						<span class="sub truncate">{p.key}</span>
					</span>
				</a>
			{/each}
		</div>
		{#if user.role === 'admin'}
			<div class="group">
				<div class="group-label">管理</div>
				<a
					href="/admin/users"
					class="item row"
					aria-current={path.startsWith('/admin/users') ? 'page' : undefined}
				>
					<Users size={16} class="muted-icon" />ユーザー
				</a>
			</div>
		{/if}
	</nav>

	<div class="footer" bind:this={footer}>
		{#if menuOpen}
			<div id="user-menu" class="menu">
				<div class="stack" style="padding: 6px 8px; line-height: 1.3">
					<span style="font-weight: 500">{user.name}</span>
					<span class="sub">{user.email}</span>
				</div>
				<div class="sep"></div>
				<a href="/account" class="item row">
					<CircleUser size={16} class="muted-icon" />アカウント
				</a>
				<form method="POST" action="/logout" style="margin: 0">
					<button type="submit" class="item row">
						<LogOut size={16} class="muted-icon" />ログアウト
					</button>
				</form>
			</div>
		{/if}
		<button
			type="button"
			class="user"
			data-testid="user-menu-trigger"
			aria-expanded={menuOpen}
			aria-controls="user-menu"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<span class="avatar" style:--c={colorFor(user.name)}>{user.name[0]}</span>
			<span class="stack" style="flex: 1; min-width: 0">
				<span style="font-weight: 500" class="truncate">{user.name}</span>
				<span class="sub truncate">{ROLE_LABEL[user.role]} · {user.email}</span>
			</span>
			<ChevronsUpDown size={16} class="muted-icon" />
		</button>
		<ThemeToggle class="icon-btn icon-btn-bordered theme" />
	</div>
</aside>

<style>
	.sidebar {
		view-transition-name: sidebar;
		width: 220px;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		color: var(--foreground);
		background: var(--sidebar);
		z-index: 40;
	}
	:global([data-sidebar='closed']) .sidebar {
		display: none;
	}
	@media (max-width: 767px) {
		.sidebar,
		:global([data-sidebar='closed']) .sidebar {
			display: flex;
			position: fixed;
			left: 0;
			top: 0;
			width: 288px;
			height: 100vh;
			transform: translateX(-100%);
			transition: transform 0.2s ease;
			box-shadow: none;
		}
		.sidebar[data-mobile-open] {
			transform: none;
			box-shadow: 0 10px 40px rgb(0 0 0 / 0.25);
		}
	}
	.stack {
		display: grid;
		line-height: 1.25;
	}
	.sub {
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sidebar :global(.muted-icon) {
		color: var(--muted-foreground);
		flex-shrink: 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		border-radius: var(--radius-sm);
	}
	.brand:hover,
	.user:hover {
		background: var(--sidebar-accent);
	}
	.brand-icon {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: var(--primary);
		color: var(--primary-foreground);
		display: grid;
		place-items: center;
	}
	.nav {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.group {
		display: grid;
		gap: 2px;
	}
	.group-label {
		height: 2rem;
		display: flex;
		align-items: center;
		padding: 0 8px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 2rem;
		padding: 0 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--sidebar-accent);
	}
	/* プロジェクト・管理の行は端まで塗る 40px 行 */
	.row {
		height: 2.5rem;
		padding: 0 12px;
		border-radius: 0;
	}
	/* 選択中は白地に青文字 */
	.item[aria-current='page'] {
		background: var(--sb-active);
		color: var(--sb-active-fg);
		font-weight: 700;
	}
	.item[aria-current='page'] :global(.muted-icon) {
		color: inherit;
	}
	/* プロジェクトは名前（太字）の下にキーを薄く出す 2 行 */
	.proj {
		height: auto;
		min-height: 3.25rem;
		padding-block: 8px;
		gap: 10px;
	}
	.proj-name {
		font-weight: 700;
	}
	.item[aria-current='page'] .sub {
		color: inherit;
		opacity: 0.75;
	}
	.footer {
		padding: 8px;
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.user {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.footer :global(.theme) {
		width: 32px;
		height: 32px;
	}
	.menu {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: calc(100% - 4px);
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--popover);
		box-shadow: var(--shadow-pop);
		z-index: 60;
	}
	.menu .item:hover {
		background: var(--accent);
	}
	.sep {
		height: 1px;
		margin: 4px -4px;
		background: var(--border);
	}
	.badge {
		margin-left: auto;
		min-width: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
	}
</style>
