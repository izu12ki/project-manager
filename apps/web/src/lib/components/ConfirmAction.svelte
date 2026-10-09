<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';

	let {
		action,
		fields = {},
		title,
		description,
		confirmLabel,
		destructive = true,
		triggerClass = 'btn btn-outline btn-sm',
		triggerLabel,
		trigger
	}: {
		action: string;
		fields?: Record<string, string>;
		title: string;
		description?: string;
		confirmLabel: string;
		destructive?: boolean;
		triggerClass?: string;
		/** アイコンのみのトリガーに付けるアクセシブルネーム */
		triggerLabel?: string;
		trigger: Snippet;
	} = $props();

	const titleId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let pending = $state(false);
</script>

<form
	method="POST"
	{action}
	style="display: contents"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			dialog?.close();
			pending = false;
			await update();
		};
	}}
>
	{#each Object.entries(fields) as [name, value] (name)}
		<input type="hidden" {name} {value} />
	{/each}
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

	<dialog bind:this={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
		<div class="body">
			<h2 id={titleId}>{title}</h2>
			{#if description}<p>{description}</p>{/if}
		</div>
		<div class="actions">
			<button type="button" class="btn btn-outline" onclick={() => dialog?.close()}>
				キャンセル
			</button>
			<button
				type="submit"
				class="btn {destructive ? 'btn-destructive' : 'btn-primary'}"
				disabled={pending}
			>
				{confirmLabel}
			</button>
		</div>
	</dialog>
</form>

<style>
	dialog {
		margin: auto;
		width: calc(100% - 32px);
		max-width: 480px;
		padding: 24px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 16px 48px rgb(0 0 0 / 0.2);
	}
	dialog[open] {
		display: grid;
		gap: 16px;
		animation: pop 0.15s ease;
	}
	dialog::backdrop {
		background: var(--overlay);
	}
	.body {
		display: grid;
		gap: 8px;
		text-align: left;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.97);
		}
	}
</style>
