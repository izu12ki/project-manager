<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	let { url }: { url: string } = $props();
	const inputId = $props.id();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 2000);
		} catch {
			// クリップボードが使えない環境では手動コピーに任せる
		}
	}
</script>

<div role="status" class="field">
	<label class="label" for={inputId}>招待リンク</label>
	<div class="box">
		<input
			id={inputId}
			readonly
			value={url}
			class="mono"
			onfocus={(e) => e.currentTarget.select()}
		/>
		<button type="button" onclick={copy}>
			{#if copied}<Check size={16} />コピーしました{:else}<Copy size={16} />コピー{/if}
		</button>
	</div>
	<p class="hint">このリンクは 7 日間有効です。メールが届かない場合は直接相手に渡してください。</p>
</div>

<style>
	.box {
		display: flex;
		height: 2rem;
		border: 1px solid var(--input);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	input {
		flex: 1;
		min-width: 0;
		border: none;
		padding: 0 12px;
		background: var(--muted);
		font-size: 0.8125rem;
		outline: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 12px;
		border: none;
		border-left: 1px solid var(--input);
		background: var(--background);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover {
		background: var(--accent);
	}
</style>
