<script lang="ts">
	import { page } from '$app/state';
	import { Kanban, List, Settings } from '@lucide/svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const tabs = $derived([
		{ href: base, label: '一覧', icon: List },
		{ href: `${base}/board`, label: 'ボード', icon: Kanban },
		...(data.isAdmin ? [{ href: `${base}/settings`, label: '設定', icon: Settings }] : [])
	]);
</script>

<div class="mb-6">
	<p class="text-xs text-gray-500">{data.project.key}</p>
	<h1 class="text-2xl font-bold">{data.project.name}</h1>
	{#if data.project.archivedAt}
		<p class="mt-1 text-sm text-amber-700">このプロジェクトはアーカイブ済みです（閲覧のみ）。</p>
	{/if}
	<nav class="mt-4 flex gap-4 border-b border-gray-200 text-sm">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class="flex items-center gap-1 border-b-2 px-1 pb-2 {page.url.pathname === t.href
					? 'border-blue-600 font-medium'
					: 'border-transparent text-gray-600'}"
			>
				<t.icon size={16} />{t.label}
			</a>
		{/each}
	</nav>
</div>

{@render children()}
