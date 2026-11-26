<script lang="ts">
	// 一覧の下に出すページ送り（課題一覧・自分の課題）。1 ページに収まるときは出さない
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { pageItems } from '#lib/pagination.ts';

	let {
		current,
		last,
		href
	}: {
		current: number;
		last: number;
		/** そのページへのリンク先 */
		href: (page: number) => string;
	} = $props();
</script>

{#if last > 1}
	<nav class="pager" aria-label="ページ送り">
		{#if current > 1}
			<a class="pager-step" href={href(current - 1)} rel="prev">
				<ChevronLeft size={16} />前へ
			</a>
		{:else}
			<span class="pager-step" aria-disabled="true"><ChevronLeft size={16} />前へ</span>
		{/if}
		{#each pageItems(current, last) as p, idx (p ?? `gap-${idx}`)}
			{#if p === null}
				<span class="pager-gap" aria-hidden="true">…</span>
			{:else if p === current}
				<span class="pager-num current" aria-current="page">{p}</span>
			{:else}
				<a class="pager-num" href={href(p)} aria-label={`${p} ページ目`}>{p}</a>
			{/if}
		{/each}
		{#if current < last}
			<a class="pager-step" href={href(current + 1)} rel="next">
				次へ<ChevronRight size={16} />
			</a>
		{:else}
			<span class="pager-step" aria-disabled="true">次へ<ChevronRight size={16} /></span>
		{/if}
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-size: 0.8125rem;
	}
	.pager-num,
	.pager-step {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-width: 32px;
		height: 32px;
		padding: 0 8px;
		border-radius: var(--radius-sm);
		font-variant-numeric: tabular-nums;
	}
	a.pager-num:hover,
	a.pager-step:hover {
		background: var(--muted);
	}
	.pager-num.current {
		background: var(--primary);
		color: var(--primary-foreground);
		font-weight: 600;
	}
	.pager-step[aria-disabled='true'] {
		color: var(--muted-foreground);
		opacity: 0.5;
	}
	.pager-gap {
		min-width: 20px;
		text-align: center;
		color: var(--muted-foreground);
	}
</style>
