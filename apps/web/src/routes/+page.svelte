<script lang="ts">
	import { ChevronRight, Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Empty from '$lib/components/ui/empty';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-6 flex items-center">
	<h1 class="text-2xl font-bold">プロジェクト</h1>
	{#if data.user?.role === 'admin'}
		<Button href="/admin/projects/new" class="ml-auto">
			<Plus data-icon="inline-start" />新規プロジェクト
		</Button>
	{/if}
</div>

{#if data.active.length === 0}
	<Empty.Root>
		<Empty.Header>
			<Empty.Title>参加しているプロジェクトはありません</Empty.Title>
		</Empty.Header>
	</Empty.Root>
{:else}
	<ul class="grid gap-4 md:grid-cols-3">
		{#each data.active as p (p.id)}
			<li>
				<a href={`/projects/${p.key}`} class="block">
					<Card.Root class="transition-colors hover:bg-muted/50">
						<Card.Header>
							<Card.Description>{p.key}</Card.Description>
							<Card.Title>{p.name}</Card.Title>
						</Card.Header>
					</Card.Root>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if data.archived.length > 0}
	<details class="group mt-8">
		<summary
			class="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight class="size-4 transition-transform group-open:rotate-90" />
			アーカイブ済み（{data.archived.length}）
		</summary>
		<div>
			<ul class="mt-2 flex flex-col gap-1 text-sm">
				{#each data.archived as p (p.id)}
					<li><a href={`/projects/${p.key}`} class="underline">{p.key} {p.name}</a></li>
				{/each}
			</ul>
		</div>
	</details>
{/if}
