<script lang="ts">
	import { customEmojiName } from '$lib/custom-emoji';
	import { getCustomEmojis } from '$lib/custom-emoji.remote';

	/** 標準の絵文字はそのまま、カスタム絵文字（:name:）は画像で出す */
	let { emoji, size = '1.25em' }: { emoji: string; size?: string } = $props();

	const name = $derived(customEmojiName(emoji));
	const custom = getCustomEmojis();
	const url = $derived(name ? custom.current?.find((e) => e.name === name)?.url : undefined);
</script>

{#if url}
	<img src={url} alt={emoji} title={emoji} style:width={size} style:height={size} />
{:else}
	<span>{emoji}</span>
{/if}

<style>
	img {
		display: inline-block;
		object-fit: contain;
		vertical-align: middle;
	}
</style>
