<script lang="ts">
	import { Eye, EyeOff } from '@lucide/svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let { ...rest }: Omit<HTMLInputAttributes, 'type'> = $props();
	let visible = $state(false);
</script>

<div style="position: relative">
	<input class="input" style="padding-right: 40px" type={visible ? 'text' : 'password'} {...rest} />
	<button
		type="button"
		class="icon-btn"
		style="position: absolute; top: 4px; right: 4px"
		aria-label="表示を切り替え"
		aria-pressed={visible}
		tabindex={-1}
		onclick={() => (visible = !visible)}
	>
		{#if visible}<EyeOff />{:else}<Eye />{/if}
	</button>
</div>
