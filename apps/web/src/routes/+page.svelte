<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-6 flex items-center">
	<h1 class="text-2xl font-bold">プロジェクト</h1>
	{#if data.user?.role === 'admin'}
		<a href="/admin/projects/new" class="btn-primary ml-auto"><Plus size={16} />新規プロジェクト</a>
	{/if}
</div>

{#if data.active.length === 0}
	<p class="text-sm text-gray-600">参加しているプロジェクトはありません。</p>
{/if}
<ul class="grid gap-4 md:grid-cols-3">
	{#each data.active as p (p.id)}
		<li>
			<a href={`/projects/${p.key}`} class="card block hover:border-blue-400">
				<p class="text-xs text-gray-500">{p.key}</p>
				<p class="font-semibold">{p.name}</p>
			</a>
		</li>
	{/each}
</ul>

{#if data.archived.length > 0}
	<details class="mt-8">
		<summary class="cursor-pointer text-sm text-gray-600"
			>アーカイブ済み（{data.archived.length}）</summary
		>
		<ul class="mt-2 space-y-1 text-sm">
			{#each data.archived as p (p.id)}
				<li><a href={`/projects/${p.key}`} class="underline">{p.key} {p.name}</a></li>
			{/each}
		</ul>
	</details>
{/if}
