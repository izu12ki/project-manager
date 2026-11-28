<script lang="ts">
	import { UserRound } from '@lucide/svelte';

	/** 担当者の絞り込みの横に置く「自分」のボタン。押すと自分が担当の課題に絞り、もう一度押すと外す */
	let {
		pressed,
		onclick
	}: { pressed: boolean; onclick: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void } =
		$props();
</script>

<button
	type="button"
	class="icon-btn icon-btn-bordered me"
	aria-pressed={pressed}
	aria-label="自分が担当の課題だけ表示"
	title={pressed ? '自分が担当の課題の絞り込みを外す' : '自分が担当の課題だけ表示'}
	{onclick}
>
	<UserRound />
</button>

<style>
	.me {
		border-radius: var(--radius-pill);
	}
	.me[aria-pressed='true'] {
		border-color: var(--primary);
		background: var(--primary-soft);
		color: var(--primary-ink);
	}
</style>
