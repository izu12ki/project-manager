<script lang="ts">
	import { reactorsLabel, type ReactionGroup } from '#lib/reactions.ts';
	import EmojiGlyph from './EmojiGlyph.svelte';
	import ReactionPicker from './ReactionPicker.svelte';

	interface Props {
		/** ツールチップの id を作るのに使う */
		id: string;
		reactions: ReactionGroup[];
		meId: string | undefined;
		/** false なら付け外しできず、誰が付けたかを見るだけ */
		canReact: boolean;
		ontoggle: (emoji: string) => void;
	}
	let { id, reactions, meId, canReact, ontoggle }: Props = $props();

	const mine = (g: ReactionGroup) => g.users.some((u) => u.id === meId);
	const selected = $derived(reactions.filter(mine).map((g) => g.emoji));
</script>

{#if reactions.length > 0}
	<div class="reactions">
		{#each reactions as g, i (g.emoji)}
			{@const tipId = `${id}-reaction-${i}`}
			<span class="reaction-wrap">
				<button
					type="button"
					class="reaction"
					class:mine={mine(g)}
					aria-pressed={mine(g)}
					aria-label={`${g.emoji} ${g.users.length}`}
					aria-describedby={tipId}
					aria-disabled={!canReact || undefined}
					onclick={() => canReact && ontoggle(g.emoji)}
				>
					<span class="emoji"><EmojiGlyph emoji={g.emoji} size="18px" /></span>
					<span class="count">{g.users.length}</span>
				</button>
				<span id={tipId} role="tooltip" class="tip">
					{reactorsLabel(g.users)} が {g.emoji} でリアクションしました
				</span>
			</span>
		{/each}
		{#if canReact}
			<ReactionPicker {selected} onpick={ontoggle} />
		{/if}
	</div>
{/if}

<style>
	.reactions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}
	.reaction-wrap {
		position: relative;
		display: inline-flex;
	}
	.reaction {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 26px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--background);
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1;
		cursor: pointer;
	}
	.reaction:hover:not([aria-disabled]) {
		background: var(--accent);
	}
	.reaction[aria-disabled] {
		cursor: default;
	}
	.reaction.mine {
		border-color: var(--primary);
		background: var(--primary-soft);
		color: var(--primary-ink);
	}
	.emoji {
		display: inline-flex;
		font-size: 0.9375rem;
	}
	.count {
		font-variant-numeric: tabular-nums;
	}
	/* 誰が付けたかをホバー・フォーカスで出す */
	.tip {
		position: absolute;
		z-index: 30;
		bottom: calc(100% + 6px);
		left: 0;
		width: max-content;
		max-width: 260px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		background: var(--foreground);
		color: var(--background);
		font-size: 0.75rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transition: opacity 0.1s;
	}
	.reaction-wrap:hover .tip,
	.reaction:focus-visible + .tip {
		opacity: 1;
		visibility: visible;
	}
</style>
