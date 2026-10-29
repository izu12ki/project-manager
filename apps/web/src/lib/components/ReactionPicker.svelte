<script lang="ts">
	import { SmilePlus } from '@lucide/svelte';
	import { page } from '$app/state';
	import { customEmojiCode, normalizeEmojiName } from '#lib/custom-emoji.ts';
	import { getCustomEmojis } from '#lib/custom-emoji.remote.ts';
	import { REACTION_EMOJIS } from '#lib/reactions.ts';

	interface Props {
		/** 自分が付けている絵文字 */
		selected: string[];
		/** メニューをボタンのどちら端に揃えるか */
		align?: 'start' | 'end';
		onpick: (emoji: string) => void;
	}
	let { selected, align = 'start', onpick }: Props = $props();

	let root: HTMLDetailsElement;
	let filter = $state('');

	const custom = getCustomEmojis();
	const shownCustom = $derived(
		(custom.current ?? []).filter((e) => e.name.includes(normalizeEmojiName(filter)))
	);

	function close(focus = false) {
		root.open = false;
		filter = '';
		if (focus) root.querySelector('summary')?.focus();
	}
	function closeOnOutside(e: PointerEvent) {
		if (root.open && !root.contains(e.target as Node)) close();
	}
	function closeOnEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && root.open) close(true);
	}
	function pick(emoji: string) {
		onpick(emoji);
		close(true);
	}
</script>

<svelte:window onpointerdown={closeOnOutside} onkeydown={closeOnEscape} />

{#snippet option(emoji: string, label: string, img?: string)}
	<button
		type="button"
		class="option"
		class:on={selected.includes(emoji)}
		aria-pressed={selected.includes(emoji)}
		aria-label={label}
		title={img ? label : undefined}
		onclick={() => pick(emoji)}
		>{#if img}<img src={img} alt="" />{:else}{emoji}{/if}</button
	>
{/snippet}

<details class="picker" bind:this={root}>
	<summary class="icon-btn" aria-label="リアクションを追加" title="リアクションを追加">
		<SmilePlus />
	</summary>
	<div class="menu" class:end={align === 'end'} role="group" aria-label="リアクション">
		<div class="grid">
			{#each REACTION_EMOJIS as emoji (emoji)}
				{@render option(emoji, emoji)}
			{/each}
		</div>
		{#if (custom.current ?? []).length > 0}
			<div class="custom">
				<input
					class="input search"
					type="search"
					placeholder="カスタム絵文字を検索"
					aria-label="カスタム絵文字を検索"
					bind:value={filter}
				/>
				<div class="scroll grid">
					{#each shownCustom as e (e.name)}
						{@render option(customEmojiCode(e.name), customEmojiCode(e.name), e.url)}
					{:else}
						<p class="empty">見つかりません</p>
					{/each}
				</div>
			</div>
		{/if}
		{#if page.data.user?.role !== 'guest'}
			<a href="/emoji" class="manage">カスタム絵文字を追加…</a>
		{/if}
	</div>
</details>

<style>
	.picker {
		position: relative;
	}
	summary {
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.picker[open] summary {
		background: var(--accent);
		color: var(--foreground);
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 4px);
		left: 0;
		display: grid;
		gap: 4px;
		width: max-content;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--popover);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
	}
	.menu.end {
		left: auto;
		right: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(8, 32px);
		gap: 2px;
	}
	.custom {
		display: grid;
		gap: 4px;
		padding-top: 4px;
		border-top: 1px solid var(--border);
	}
	.search {
		height: 1.75rem;
		padding: 0 8px;
		font-size: 0.8125rem;
	}
	.scroll {
		max-height: 172px;
		overflow-y: auto;
	}
	.empty {
		grid-column: 1 / -1;
		margin: 0;
		padding: 6px 4px;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.option {
		display: grid;
		place-items: center;
		height: 32px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 1.125rem;
		line-height: 1;
		cursor: pointer;
	}
	.option img {
		width: 22px;
		height: 22px;
		object-fit: contain;
	}
	.option:hover {
		background: var(--accent);
	}
	.option.on {
		border-color: var(--primary);
		background: var(--primary-soft);
	}
	.manage {
		padding: 4px 6px;
		border-top: 1px solid var(--border);
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.manage:hover {
		color: var(--foreground);
		text-decoration: underline;
	}
</style>
