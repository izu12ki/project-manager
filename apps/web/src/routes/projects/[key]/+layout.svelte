<script lang="ts">
	import { page } from '$app/state';
	import { Kanban, List, Settings } from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { cn } from '$lib/utils';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const tabs = $derived([
		{ href: base, label: '一覧', icon: List },
		{ href: `${base}/board`, label: 'ボード', icon: Kanban },
		...(data.isAdmin ? [{ href: `${base}/settings`, label: '設定', icon: Settings }] : [])
	]);
</script>

<div class="mb-6 flex flex-col gap-2">
	<p class="text-xs text-muted-foreground">{data.project.key}</p>
	<h1 class="text-2xl font-bold">{data.project.name}</h1>
	{#if data.project.archivedAt}
		<Alert.Root>
			<Alert.Description>このプロジェクトはアーカイブ済みです（閲覧のみ）。</Alert.Description>
		</Alert.Root>
	{/if}
	<nav
		class="mt-2 inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground"
	>
		{#each tabs as t (t.href)}
			{@const isActive = page.url.pathname === t.href}
			<a
				href={t.href}
				aria-current={isActive ? 'page' : undefined}
				class={cn(
					'inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm',
					isActive && 'bg-background text-foreground shadow-sm'
				)}
			>
				<t.icon size={16} />{t.label}
			</a>
		{/each}
	</nav>
</div>

{@render children()}
