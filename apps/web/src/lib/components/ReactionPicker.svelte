<script lang="ts">
	import { SmilePlus } from '@lucide/svelte';
	import { REACTION_EMOJIS } from '$lib/reactions';

	interface Props {
		/** 自分が付けている絵文字 */
		selected: string[];
		/** メニューをボタンのどちら端に揃えるか */
		align?: 'start' | 'end';
		onpick: (emoji: string) => void;
	}
	let { selected, align = 'start', onpick }: Props = $props();

	let root: HTMLDetailsElement;

	function close(focus = false) {
		root.open = false;
		if (focus) root.querySelector('summary')?.focus();
	}
	function closeOnOutside(e: PointerEvent) {
		if (root.open && !root.contains(e.target as Node)) close();
	}
	function closeOnEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && root.open) close(true);
	}
</script>

<svelte:window onpointerdown={closeOnOutside} onkeydown={closeOnEscape} />

<details class="picker" bind:this={root}>
	<summary class="icon-btn" aria-label="リアクションを追加" title="リアクションを追加">
		<SmilePlus />
	</summary>
	<div class="menu" class:end={align === 'end'} role="group" aria-label="リアクション">
		{#each REACTION_EMOJIS as emoji (emoji)}
			<button
				type="button"
				class="option"
				class:on={selected.includes(emoji)}
				aria-pressed={selected.includes(emoji)}
				aria-label={emoji}
				onclick={() => {
					onpick(emoji);
					close(true);
				}}>{emoji}</button
			>
		{/each}
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
		grid-template-columns: repeat(4, 36px);
		gap: 2px;
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
	.option {
		height: 36px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}
	.option:hover {
		background: var(--accent);
	}
	.option.on {
		border-color: var(--primary);
		background: var(--primary-soft);
	}
</style>
