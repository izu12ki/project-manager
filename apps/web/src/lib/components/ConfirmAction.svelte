<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';
	import type { ActionResult } from '$app/forms';
	import { enhance } from '#lib/forms.ts';

	let {
		action,
		onconfirm,
		fields = {},
		title,
		description,
		confirmLabel,
		triggerClass = 'btn btn-outline btn-sm',
		triggerLabel,
		trigger,
		dialog = $bindable(),
		onclose,
		onresult
	}: {
		/** 送信先の form action（onconfirm を渡す場合は不要） */
		action?: string;
		/** 渡すと form action の代わりに確定時に呼ぶ（remote function の command 用） */
		onconfirm?: () => Promise<void>;
		fields?: Record<string, string>;
		/** 見出しバーの短い名前（例: 課題の削除） */
		title: string;
		/** 中央に出す確認文。改行（\n）はそのまま改行になる */
		description?: string;
		confirmLabel: string;
		triggerClass?: string;
		/** アイコンのみのトリガーに付けるアクセシブルネーム */
		triggerLabel?: string;
		/** 省略すると既定のトリガーボタンを出さない（dialog を bind して外から開く） */
		trigger?: Snippet;
		/** 確認ダイアログ本体。外のコントロールから showModal() するために bind する */
		dialog?: HTMLDialogElement;
		/** ダイアログが閉じたとき（キャンセル・確定のどちらでも）に呼ぶ */
		onclose?: () => void;
		/** form action の応答が返ったときに呼ぶ */
		onresult?: (result: ActionResult) => void;
	} = $props();

	const titleId = $props.id();
	let pending = $state(false);
</script>

{#snippet body()}
	{#each Object.entries(fields) as [name, value] (name)}
		<input type="hidden" {name} {value} />
	{/each}
	{#if trigger}
		<button
			type="button"
			class={triggerClass}
			aria-label={triggerLabel}
			title={triggerLabel}
			onclick={() => dialog?.showModal()}
		>
			{@render trigger()}
		</button>
		<noscript><button type="submit" class={triggerClass}>{@render trigger()}</button></noscript>
	{/if}

	<dialog
		bind:this={dialog}
		{onclose}
		role="alertdialog"
		aria-modal="true"
		aria-labelledby={titleId}
	>
		<header>
			<h2 id={titleId}>{title}</h2>
			<button type="button" class="close" aria-label="閉じる" onclick={() => dialog?.close()}>
				<X />
			</button>
		</header>
		{#if description}<p>{description}</p>{/if}
		<div class="actions">
			<button type="button" class="btn btn-outline" onclick={() => dialog?.close()}>
				キャンセル
			</button>
			<button type="submit" class="btn btn-primary" disabled={pending}>
				{confirmLabel}
			</button>
		</div>
	</dialog>
{/snippet}

{#if onconfirm}
	<form
		style="display: contents"
		onsubmit={async (e) => {
			e.preventDefault();
			pending = true;
			try {
				await onconfirm();
			} finally {
				dialog?.close();
				pending = false;
			}
		}}
	>
		{@render body()}
	</form>
{:else}
	<form
		method="POST"
		{action}
		style="display: contents"
		use:enhance={() => {
			pending = true;
			return async ({ result, update }) => {
				dialog?.close();
				pending = false;
				onresult?.(result);
				await update();
			};
		}}
	>
		{@render body()}
	</form>
{/if}

<style>
	dialog {
		margin: auto;
		width: calc(100% - 32px);
		max-width: 420px;
		padding: 0;
		border: none;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 16px 48px rgb(0 0 0 / 0.2);
	}
	dialog[open] {
		animation: pop 0.15s ease;
	}
	dialog::backdrop {
		background: var(--overlay);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 8px 8px 16px;
		background: var(--primary);
		color: var(--primary-foreground);
	}
	h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.close:hover {
		background: rgb(255 255 255 / 0.15);
	}
	.close :global(svg) {
		width: 20px;
		height: 20px;
	}
	p {
		margin: 0;
		padding: 24px 20px 0;
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.7;
		text-align: center;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		padding: 20px;
	}
	.actions .btn {
		min-width: 104px;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.97);
		}
	}
</style>
