<script lang="ts">
	import { CircleAlert } from '@lucide/svelte';

	let { message, title }: { message: string; title?: string } = $props();
</script>

<div role="alert" class="alert alert-destructive">
	<CircleAlert />
	{#if title}
		<div class="alert-title">{title}</div>
		<div style="grid-column: 2; opacity: 0.9">{message}</div>
	{:else}
		<div>{message}</div>
	{/if}
</div>
