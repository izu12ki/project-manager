<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Project Manager</title>
</svelte:head>

<ModeWatcher />
<Toaster richColors position="top-right" />

{#if data.user}
	<Sidebar.Provider>
		<AppSidebar user={data.user} projects={data.projects} />
		<Sidebar.Inset>
			<header class="flex h-12 items-center gap-2 border-b px-4">
				<Sidebar.Trigger />
			</header>
			<div class="mx-auto w-full max-w-6xl p-6">
				{@render children()}
			</div>
		</Sidebar.Inset>
	</Sidebar.Provider>
{:else}
	<div class="flex min-h-svh items-center justify-center bg-muted p-6">
		<main class="w-full max-w-sm">
			{@render children()}
		</main>
	</div>
{/if}
