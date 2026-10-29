<script lang="ts">
	import { COLORS, COLOR_LABEL, colorVar } from '#lib/labels.ts';

	interface Props {
		name: string;
		value?: string;
		/** 「自動」（値は ''）を選択肢に加える */
		allowAuto?: boolean;
		label: string;
		onchange?: (value: string) => void;
	}
	let { name, value = COLORS[0], allowAuto = false, label, onchange }: Props = $props();
</script>

<div
	class="swatches"
	role="radiogroup"
	aria-label={label}
	onchange={(e) => onchange?.((e.target as HTMLInputElement).value)}
>
	{#if allowAuto}
		<label class="swatch auto" title="自動">
			<input type="radio" {name} value="" checked={value === ''} />
			<span class="sr-only">自動</span>
			<span aria-hidden="true">自動</span>
		</label>
	{/if}
	{#each COLORS as c (c)}
		<label class="swatch" style:--c={colorVar(c)} title={COLOR_LABEL[c]}>
			<input type="radio" {name} value={c} checked={value === c} />
			<span class="sr-only">{COLOR_LABEL[c]}</span>
		</label>
	{/each}
</div>

<style>
	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		background: var(--c);
		cursor: pointer;
	}
	.swatch.auto {
		width: auto;
		padding: 0 8px;
		border: 1px dashed var(--border);
		background: transparent;
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}
	.swatch input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.swatch:has(input:checked) {
		outline: 2px solid var(--foreground);
		outline-offset: 2px;
	}
	.swatch:has(input:focus-visible) {
		box-shadow: 0 0 0 4px var(--ring-soft);
	}
</style>
