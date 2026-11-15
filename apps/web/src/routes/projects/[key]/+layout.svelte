<script lang="ts">
	import { page } from '$app/state';
	import { Archive, ChartGantt, List, Plus, Settings, SquareKanban } from '@lucide/svelte';
	import ProjectIcon from '#lib/components/ProjectIcon.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const tabs = $derived([
		{ href: base, label: '一覧', icon: List },
		{ href: `${base}/board`, label: 'ボード', icon: SquareKanban },
		{ href: `${base}/timeline`, label: 'タイムライン', icon: ChartGantt },
		...(data.isAdmin ? [{ href: `${base}/settings`, label: '設定', icon: Settings }] : [])
	]);
	const current = $derived(tabs.find((t) => t.href === page.url.pathname));
	const plain = (md: string) =>
		md
			.replace(/[#>*_`~[\]()-]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
</script>

{#if current}
	<div class="grid gap-4">
		<div class="flex flex-wrap items-end justify-between gap-4">
			<div class="grid min-w-0 gap-1">
				<div class="flex flex-wrap items-center gap-3">
					<ProjectIcon project={data.project} />
					<h1 class="page-title">{data.project.name}</h1>
					<span class="mono text-xs font-medium text-muted-foreground">{data.project.key}</span>
				</div>
				{#if data.project.description}
					<p class="page-desc">{plain(data.project.description)}</p>
				{/if}
			</div>
			{#if !data.project.archivedAt && current.label !== '設定'}
				<a href={`${base}/issues/new`} class="btn btn-primary"><Plus />新規課題</a>
			{/if}
		</div>
		{#if data.project.archivedAt}
			<div role="status" class="alert">
				<Archive />
				<div>このプロジェクトはアーカイブ済みです（閲覧のみ）。</div>
			</div>
		{/if}
		<nav aria-label="プロジェクト内タブ" class="tabs">
			{#each tabs as t (t.href)}
				<a href={t.href} class="tab" aria-current={t === current ? 'page' : undefined}>
					<t.icon size={16} />{t.label}
				</a>
			{/each}
		</nav>
	</div>
{/if}

{@render children()}

<style>
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
		overflow-y: hidden;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2.625rem;
		padding: 0 12px;
		color: var(--muted-foreground);
		font-weight: 600;
		white-space: nowrap;
	}
	.tab:hover {
		color: var(--foreground);
		text-decoration: none;
	}
	.tab[aria-current='page'] {
		color: var(--primary-ink);
		box-shadow: inset 0 -2px 0 var(--primary);
	}
</style>
