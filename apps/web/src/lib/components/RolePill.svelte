<script lang="ts">
	import { ROLE_CLASS, ROLE_COLOR, ROLE_LABEL } from '#lib/labels.ts';

	let { role }: { role: keyof typeof ROLE_LABEL } = $props();
</script>

<span class="pill {ROLE_CLASS[role]}" style:--c={ROLE_COLOR[role]}>{ROLE_LABEL[role]}</span>
