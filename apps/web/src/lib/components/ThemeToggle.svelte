<script lang="ts">
	import { onMount } from 'svelte';
	import { Moon, Sun } from '@lucide/svelte';
	import { theme } from '#lib/theme.svelte.ts';

	let { class: className = 'icon-btn icon-btn-bordered' }: { class?: string } = $props();

	onMount(() => theme.init());
</script>

<button
	type="button"
	class={className}
	aria-label="テーマを切り替え"
	title="テーマを切り替え"
	onclick={() => theme.toggle()}
>
	{#if theme.current === 'dark'}<Moon />{:else}<Sun />{/if}
</button>
