<script lang="ts">
	import { X } from '@lucide/svelte';

	// ページに 1 つ置く。.markdown 内の画像（.md-img）のクリックで拡大表示する
	const titleId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let image = $state<{ src: string; alt: string } | null>(null);

	function onclick(e: MouseEvent) {
		const img = (e.target as Element | null)?.closest?.('.markdown .md-img img');
		if (!(img instanceof HTMLImageElement) || img.closest('a')) return;
		image = { src: img.currentSrc || img.src, alt: img.alt };
		dialog?.showModal();
	}
</script>

<svelte:document {onclick} />

<!-- 背景（::backdrop）のクリックは dialog 自身が target になる -->
<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	onclose={() => (image = null)}
	onclick={(e) => {
		if (e.target === dialog) dialog?.close();
	}}
>
	<h2 id={titleId} class="sr-only">画像の拡大表示</h2>
	<button type="button" class="close" aria-label="閉じる" onclick={() => dialog?.close()}>
		<X />
	</button>
	{#if image}<img src={image.src} alt={image.alt} />{/if}
</dialog>

<style>
	dialog {
		margin: auto;
		padding: 0;
		border: none;
		background: transparent;
		max-width: 95vw;
		max-height: 95vh;
		overflow: visible;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.8);
	}
	img {
		display: block;
		max-width: 95vw;
		max-height: 90vh;
		object-fit: contain;
		border-radius: var(--radius-sm);
		background: white;
	}
	.close {
		position: fixed;
		top: 16px;
		right: 16px;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.6);
		color: white;
		cursor: pointer;
	}
	.close :global(svg) {
		width: 20px;
		height: 20px;
	}
</style>
