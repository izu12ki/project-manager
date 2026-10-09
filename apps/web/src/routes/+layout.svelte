<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { FolderKanban, LogOut, UserRound, Users } from '@lucide/svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
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
	<header class="border-b border-gray-200 bg-white">
		<nav class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
			<a href="/" class="flex items-center gap-2 font-semibold">
				<FolderKanban size={18} />Project Manager
			</a>
			<div class="ml-auto flex items-center gap-4">
				{#if data.user.role === 'admin'}
					<a href="/admin/users" class="flex items-center gap-1"><Users size={16} />ユーザー</a>
				{/if}
				<a href="/account" class="flex items-center gap-1"
					><UserRound size={16} />{data.user.name}</a
				>
				<form method="POST" action="/logout">
					<button class="flex items-center gap-1"><LogOut size={16} />ログアウト</button>
				</form>
			</div>
		</nav>
	</header>
{/if}

<main class="mx-auto max-w-6xl px-4 py-6">
	{@render children()}
</main>
