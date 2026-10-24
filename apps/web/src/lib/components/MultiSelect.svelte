<script lang="ts">
	interface Props {
		/** 見出しの要素には `${id}-label` の id を付けること */
		id: string;
		/** フォームに送るチェックボックスの name（選んだ数だけ同じ name で送る） */
		name: string;
		options: { value: string; label: string }[];
		selected?: string[];
		placeholder?: string;
		'aria-describedby'?: string;
	}
	let {
		id,
		name,
		options,
		selected = $bindable([]),
		placeholder = '選択してください',
		'aria-describedby': describedBy
	}: Props = $props();

	let root: HTMLDetailsElement;
	const summary = $derived(
		options
			.filter((o) => selected.includes(o.value))
			.map((o) => o.label)
			.join('、')
	);

	function closeOnOutside(e: PointerEvent) {
		if (root.open && !root.contains(e.target as Node)) root.open = false;
	}
	function closeOnEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && root.open) {
			root.open = false;
			root.querySelector('summary')?.focus();
		}
	}
</script>

<svelte:window onpointerdown={closeOnOutside} onkeydown={closeOnEscape} />

<details class="multi" bind:this={root}>
	<summary
		class="select"
		{id}
		aria-labelledby={`${id}-label ${id}-value`}
		aria-describedby={describedBy}
	>
		<span id={`${id}-value`} class="truncate" class:text-muted-foreground={!summary}
			>{summary || placeholder}</span
		>
	</summary>
	<div class="menu" role="group" aria-labelledby={`${id}-label`}>
		{#each options as o (o.value)}
			<label class="option">
				<input type="checkbox" {name} value={o.value} bind:group={selected} />
				<span class="truncate">{o.label}</span>
			</label>
		{:else}
			<p class="m-0 px-2 py-1.5 text-[13px] text-muted-foreground">選択肢がありません</p>
		{/each}
	</div>
</details>

<style>
	.multi {
		position: relative;
	}
	summary {
		display: flex;
		align-items: center;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.multi[open] summary {
		border-color: var(--ring);
		box-shadow: 0 0 0 3px var(--ring-soft);
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		display: grid;
		max-height: 260px;
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--popover);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
	}
	.option {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 6px 8px;
		border-radius: 4px;
		cursor: pointer;
	}
	.option:hover {
		background: var(--accent);
	}
	.option input {
		flex-shrink: 0;
		accent-color: var(--primary);
	}
</style>
