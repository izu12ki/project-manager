<script lang="ts">
	import { PRIORITY_CLASS, PRIORITY_LABEL, type Priority } from '#lib/labels.ts';

	let { priority, small = false }: { priority: Priority; small?: boolean } = $props();
</script>

<span
	class="pill {PRIORITY_CLASS[priority]}"
	style:--c="var(--c-orange)"
	style:height={small ? '20px' : undefined}
	style:font-size={small ? '11px' : undefined}
	style:padding={small ? '0 8px' : undefined}
>
	{PRIORITY_LABEL[priority]}
</span>
