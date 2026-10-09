<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button, buttonVariants, type ButtonVariant } from '$lib/components/ui/button';

	let {
		action,
		fields = {},
		title,
		description,
		confirmLabel,
		triggerVariant = 'outline',
		confirmVariant = 'destructive',
		trigger
	}: {
		action: string;
		fields?: Record<string, string>;
		title: string;
		description?: string;
		confirmLabel: string;
		triggerVariant?: ButtonVariant;
		confirmVariant?: ButtonVariant;
		trigger: Snippet;
	} = $props();

	const formId = $props.id();
	let open = $state(false);
</script>

<!-- AlertDialog の中身は body にポータルされるため、フォームは外に置き form 属性で送信する -->
<form
	id={formId}
	class="contents"
	method="POST"
	{action}
	use:enhance={() =>
		async ({ update }) => {
			open = false;
			await update();
		}}
>
	{#each Object.entries(fields) as [name, value] (name)}
		<input type="hidden" {name} {value} />
	{/each}
	<noscript>
		<Button type="submit" variant={triggerVariant} size="sm">{@render trigger()}</Button>
	</noscript>
</form>

<AlertDialog.Root bind:open>
	<AlertDialog.Trigger class={buttonVariants({ variant: triggerVariant, size: 'sm' })}>
		{@render trigger()}
	</AlertDialog.Trigger>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			{#if description}<AlertDialog.Description>{description}</AlertDialog.Description>{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
			<AlertDialog.Action type="submit" form={formId} variant={confirmVariant}>
				{confirmLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
