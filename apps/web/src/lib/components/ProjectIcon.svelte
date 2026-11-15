<script lang="ts">
	import { projectColor, projectIcon } from '#lib/labels.ts';

	let {
		project,
		size = 32
	}: {
		project: { key: string; icon: string | null; color: string | null };
		size?: number;
	} = $props();
</script>

<span
	class="avatar avatar-square"
	style:--size={`${size}px`}
	style:--c={projectColor(project)}
	aria-hidden="true">{projectIcon(project)}</span
>
