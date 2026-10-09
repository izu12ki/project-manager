<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Status } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Columns = typeof data.columns;
	type Card = Columns[Status][number];

	const clone = (c: Columns): Columns =>
		Object.fromEntries(STATUSES.map((s) => [s, [...c[s]]])) as Columns;

	let columns = $derived(clone(data.columns));
	let snapshot: Columns | null = null;
	let message = $state<string | null>(null);
	let pending = $state(false);

	function consider(status: Status, e: CustomEvent<DndEvent<Card>>) {
		message = null;
		snapshot ??= clone(columns);
		columns = { ...columns, [status]: e.detail.items };
	}

	async function finalize(status: Status, e: CustomEvent<DndEvent<Card>>) {
		const items = e.detail.items;
		columns = { ...columns, [status]: items };
		const idx = items.findIndex((i) => i.id === e.detail.info.id);
		if (idx === -1) return; // 移動元の列。移動先の列の finalize で送信する
		const before = snapshot;
		snapshot = null;
		pending = true;

		const fd = new FormData();
		fd.set('issueId', String(e.detail.info.id));
		fd.set('status', status);
		fd.set('beforeId', items[idx - 1]?.id ?? '');
		fd.set('afterId', items[idx + 1]?.id ?? '');
		let failure: string | null = null;
		try {
			const res = await fetch('?/move', {
				method: 'POST',
				body: fd,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type !== 'success') {
				failure =
					result.type === 'failure' && typeof result.data?.message === 'string'
						? result.data.message
						: 'この課題は移動できません';
			}
		} catch {
			failure = 'この課題は移動できません';
		}
		try {
			if (failure !== null) {
				if (before) columns = before;
				message = failure;
			}
			await invalidateAll();
		} catch {
			// 再取得に失敗しても楽観表示を残さない（失敗時は上で巻き戻し済み）
		} finally {
			pending = false;
		}
	}
</script>

{#if message}
	<Alert.Root variant="destructive" class="mb-4">
		<Alert.Description>{message}</Alert.Description>
	</Alert.Root>
{/if}

<div class="grid grid-cols-1 gap-4 md:grid-cols-4">
	{#each STATUSES as status (status)}
		<section
			class="flex flex-col gap-2 rounded-lg bg-muted p-2"
			data-testid={`column-${status}`}
			aria-label={STATUS_LABEL[status]}
		>
			<h3 class="flex items-center gap-2 px-1 text-sm font-semibold">
				{STATUS_LABEL[status]}
				<Badge variant="secondary">{columns[status].length}</Badge>
			</h3>
			<ul
				class="flex min-h-24 flex-col gap-2"
				use:dndzone={{
					items: columns[status],
					flipDurationMs: 150,
					type: 'issue',
					dragDisabled: !!data.project.archivedAt || pending
				}}
				onconsider={(e) => consider(status, e)}
				onfinalize={(e) => finalize(status, e)}
			>
				{#each columns[status] as card (card.id)}
					<li
						class="cursor-grab rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xs"
						data-testid={`card-${card.number}`}
					>
						<a
							href={`/projects/${data.project.key}/issues/${card.number}`}
							class="text-xs text-muted-foreground hover:underline"
						>
							{data.project.key}-{card.number}
						</a>
						<p class="font-medium">{card.title}</p>
						<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{card.assigneeName ?? '未割り当て'}</span>
							{#if card.priority !== 'none'}
								<Badge variant="outline">優先度: {PRIORITY_LABEL[card.priority]}</Badge>
							{/if}
							{#if card.dueDate}<span>期限: {card.dueDate}</span>{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
