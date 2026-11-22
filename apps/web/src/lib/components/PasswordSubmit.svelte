<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// ハイドレーションが終わるまで押せなくする。それより前に送る（Enter を含む）と、
	// パスワードがブラウザで鍵（withPasswordKeys）に置き換わらず、生のパスワードだけが届くため
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
</script>

<button type="submit" class="btn btn-primary" disabled={!ready}>{@render children()}</button>
<noscript><p class="hint">JavaScript を有効にしてください</p></noscript>
