<script lang="ts">
	import { Paperclip } from '@lucide/svelte';

	// どこに入れるか（textarea かエディタか）は呼び出し側が onFiles で決める。
	// projectKey は呼び出し側との取り決め（どのプロジェクトへの添付か）として受け取るが、使うのは onFiles 側
	// eslint-disable-next-line svelte/no-unused-props
	let props: { projectKey: string; onFiles: (files: File[]) => void } = $props();
	let input = $state<HTMLInputElement>();

	function onchange() {
		const files = Array.from(input!.files ?? []);
		input!.value = ''; // 同じファイルを続けて選べるように
		if (files.length > 0) props.onFiles(files);
	}
</script>

<!-- mousedown で入力欄のフォーカス（キャレット位置）を奪わない -->
<button
	type="button"
	class="icon-btn"
	aria-label="ファイルを添付"
	title="ファイルを添付"
	onmousedown={(e) => e.preventDefault()}
	onclick={() => input!.click()}
>
	<Paperclip />
</button>
<!-- name を付けないのでフォーム送信には含まれない -->
<input bind:this={input} type="file" multiple hidden {onchange} data-testid="attach-input" />
