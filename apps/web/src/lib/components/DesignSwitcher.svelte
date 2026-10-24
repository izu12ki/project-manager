<script lang="ts">
	// デザイン案の比較用（一時的）。プレビュー環境でだけ右下に出す。採用案が決まったら消す
	import { onMount } from 'svelte';

	type Design = '' | 'a' | 'b';
	const OPTIONS: { value: Design; label: string }[] = [
		{ value: '', label: '現行' },
		{ value: 'a', label: 'A まるみ' },
		{ value: 'b', label: 'B カラフル' }
	];

	let visible = $state(false);
	let current = $state<Design>('');

	onMount(() => {
		visible = location.hostname.includes('preview');
		const d = document.documentElement.dataset.design;
		current = d === 'a' || d === 'b' ? d : '';
	});

	function select(value: Design) {
		current = value;
		if (value) document.documentElement.dataset.design = value;
		else delete document.documentElement.dataset.design;
		try {
			localStorage.setItem('design', value);
		} catch {
			// 保存できなくても表示の切り替えは有効
		}
	}
</script>

{#if visible}
	<div class="switcher" role="group" aria-label="デザイン案">
		{#each OPTIONS as o (o.value)}
			<button type="button" aria-pressed={current === o.value} onclick={() => select(o.value)}
				>{o.label}</button
			>
		{/each}
	</div>
{/if}

<style>
	.switcher {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 70;
		display: flex;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--popover);
		box-shadow: var(--shadow-pop);
	}
	button {
		height: 28px;
		padding: 0 12px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--muted-foreground);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		background: var(--primary);
		color: var(--primary-foreground);
	}
</style>
