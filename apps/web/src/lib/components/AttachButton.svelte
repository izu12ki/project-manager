<script lang="ts">
	import { Paperclip } from '@lucide/svelte';
	import { insertUploads } from '$lib/attachment-upload';

	let {
		projectKey,
		target
	}: { projectKey: string; target: () => HTMLTextAreaElement | null | undefined } = $props();
	let input = $state<HTMLInputElement>();

	async function onchange() {
		const el = target();
		const files = Array.from(input!.files ?? []);
		input!.value = ''; // 同じファイルを続けて選べるように
		if (el && files.length > 0) await insertUploads(el, projectKey, files);
	}
</script>

<button
	type="button"
	class="icon-btn"
	aria-label="ファイルを添付"
	title="ファイルを添付"
	onclick={() => input!.click()}
>
	<Paperclip />
</button>
<!-- name を付けないのでフォーム送信には含まれない -->
<input bind:this={input} type="file" multiple hidden {onchange} data-testid="attach-input" />
