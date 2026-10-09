<script lang="ts">
	import { STATUS_COLOR, STATUS_LABEL, type Status } from '$lib/labels';

	let { status }: { status: Status } = $props();
</script>

<span class="pill pill-tint pill-status" style:--c={STATUS_COLOR[status]}
	>{STATUS_LABEL[status]}</span
>
