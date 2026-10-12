<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Calendar, CircleAlert, X } from '@lucide/svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import PriorityPill from '$lib/components/PriorityPill.svelte';
	import {
		STATUSES,
		STATUS_COLOR,
		STATUS_LABEL,
		colorFor,
		formatDue,
		isDueAlert,
		type Status
	} from '$lib/labels';
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

<section class="grid gap-4">
	{#if message}
		<div role="alert" class="alert alert-destructive" style="grid-template-columns: 16px 1fr auto">
			<CircleAlert />
			<div>
				<div class="alert-title">ステータスを変更できませんでした</div>
				<div style="opacity: 0.9">{message}</div>
			</div>
			<button type="button" class="icon-btn" aria-label="閉じる" onclick={() => (message = null)}>
				<X />
			</button>
		</div>
	{/if}

	<div class="board">
		{#each STATUSES as status (status)}
			<section
				class="column"
				style:--c={STATUS_COLOR[status]}
				data-testid={`column-${status}`}
				aria-label={STATUS_LABEL[status]}
			>
				<h2 class="column-head">
					{STATUS_LABEL[status]}
					<span class="count">{columns[status].length}</span>
				</h2>
				<ul
					use:dndzone={{
						items: columns[status],
						flipDurationMs: 150,
						type: 'issue',
						dragDisabled: !!data.project.archivedAt || pending,
						dropTargetStyle: { outline: '2px dashed var(--ring)', outlineOffset: '2px' }
					}}
					onconsider={(e) => consider(status, e)}
					onfinalize={(e) => finalize(status, e)}
				>
					{#each columns[status] as card (card.id)}
						<li class="card-item" data-testid={`card-${card.number}`}>
							<div class="flex items-center justify-between gap-2">
								<span class="mono text-xs text-muted-foreground"
									>{data.project.key}-{card.number}</span
								>
								{#if card.priority !== 'none'}<PriorityPill priority={card.priority} small />{/if}
							</div>
							<a href={`/projects/${data.project.key}/issues/${card.number}`} class="title"
								>{card.title}</a
							>
							<div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
								<span class="flex min-w-0 items-center gap-1.5">
									<span class="avatar" style="--size: 20px" style:--c={colorFor(card.assigneeName)}
										>{card.assigneeName?.[0] ?? '–'}</span
									>
									<span class="truncate">{card.assigneeName ?? '未割当'}</span>
								</span>
								<span
									class="flex shrink-0 items-center gap-1"
									style:color={isDueAlert(card.dueDate, status) ? 'var(--destructive)' : undefined}
								>
									<Calendar size={12} />{formatDue(card.dueDate)}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</section>

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(4, minmax(264px, 1fr));
		gap: 12px;
		overflow-x: auto;
		padding-bottom: 8px;
	}
	.column {
		background: var(--col);
		border: 1px solid var(--border);
		border-top: 3px solid var(--c);
		border-radius: 6px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 480px;
	}
	.column-head {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px;
		height: 24px;
		font-size: 14px;
		font-weight: 700;
	}
	.count {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border-radius: 4px;
		background: color-mix(in oklch, var(--c) 16%, transparent);
		color: color-mix(in oklch, var(--c) 75%, var(--foreground));
		font-size: 12px;
	}
	ul {
		flex: 1;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 80px;
		border-radius: 4px;
	}
	.card-item {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 12px;
		display: grid;
		gap: 10px;
		cursor: grab;
		transition: border-color 0.15s ease;
	}
	.card-item:hover {
		border-color: var(--primary);
	}
	.title {
		font-weight: 500;
		line-height: 1.45;
		text-wrap: pretty;
	}
	.title:hover {
		text-decoration: underline;
	}
</style>
