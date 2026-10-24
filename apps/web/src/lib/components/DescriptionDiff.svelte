<script lang="ts">
	import { diffText } from '$lib/text-diff';

	let { before, after }: { before: string; after: string } = $props();
	const rows = $derived(diffText(before, after));
	const MARK = { same: '', add: '+', del: '-' } as const;
	const LABEL = { same: '', add: '追加', del: '削除' } as const;
</script>

{#if rows.length === 0}
	<p class="m-0 text-xs text-muted-foreground">改行のみの変更です</p>
{:else}
	<div class="diff">
		{#each rows as r, i (i)}
			{#if r.kind === 'skip'}
				<div class="row skip">… {r.count}行 変更なし</div>
			{:else}
				<div class="row {r.kind}">
					<span class="mark" aria-hidden="true">{MARK[r.kind]}</span>
					{#if LABEL[r.kind]}<span class="sr-only">{LABEL[r.kind]}:</span>{/if}
					<span class="text"
						>{#each r.segments as s, j (j)}{#if s.changed}<mark>{s.text}</mark
								>{:else}{s.text}{/if}{/each}</span
					>
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.diff {
		display: grid;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--card);
		font-size: 13px;
		line-height: 1.6;
	}
	.row {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr);
		min-height: 1.6em;
		padding: 0 8px 0 0;
	}
	.mark {
		color: var(--muted-foreground);
		text-align: center;
		user-select: none;
	}
	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.add {
		background: color-mix(in oklch, var(--c-green) 14%, transparent);
	}
	.del {
		background: color-mix(in oklch, var(--destructive) 12%, transparent);
	}
	.add mark {
		background: color-mix(in oklch, var(--c-green) 38%, transparent);
	}
	.del mark {
		background: color-mix(in oklch, var(--destructive) 32%, transparent);
		text-decoration: line-through;
	}
	mark {
		color: inherit;
		border-radius: 2px;
	}
	.skip {
		display: block;
		padding: 2px 8px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 12px;
	}
</style>
