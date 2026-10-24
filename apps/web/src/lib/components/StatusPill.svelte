<script lang="ts">
	import { page } from '$app/state';
	import { statusColor, statusName, type Status, type StatusDef } from '$lib/labels';

	// 定義を渡さなければ、プロジェクト配下のページで読み込んだ定義を使う
	let { status, statuses = page.data.statuses }: { status: Status; statuses?: StatusDef[] } =
		$props();
</script>

<span class="pill pill-tint pill-status" style:--c={statusColor(statuses, status)}
	>{statusName(statuses, status)}</span
>
