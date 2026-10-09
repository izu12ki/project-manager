<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	let { url }: { url: string } = $props();
	let copiedUrl = $state<string | null>(null);
	const copied = $derived(copiedUrl === url);

	async function copy() {
		await navigator.clipboard.writeText(url);
		copiedUrl = url;
	}
</script>

<div class="rounded border border-green-300 bg-green-50 p-3 text-sm">
	<label class="block">
		<span>招待リンク</span>
		<input
			class="input font-mono text-xs"
			readonly
			value={url}
			onfocus={(e) => e.currentTarget.select()}
		/>
	</label>
	<button type="button" class="btn mt-2" onclick={copy}>
		{#if copied}<Check size={14} />コピーしました{:else}<Copy size={14} />コピー{/if}
	</button>
	<p class="mt-2 text-xs text-gray-600">
		このリンクは 7 日間有効です。メールが届かない場合は直接相手に渡してください。
	</p>
</div>
