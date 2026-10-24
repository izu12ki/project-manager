<script lang="ts">
	import { colorVar } from '$lib/labels';

	let { name, color }: { name: string; color: string | null } = $props();
</script>

<span class="type-tag" style:--c={colorVar(color)}>{name}</span>

<style>
	.type-tag {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		max-width: 8em;
		height: 20px;
		padding: 0 7px;
		overflow: hidden;
		border-radius: var(--radius-pill);
		background: var(--c);
		color: white;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
</style>
