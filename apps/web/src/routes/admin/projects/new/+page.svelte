<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">新規プロジェクト</h1>
<Card.Root class="max-w-lg">
	<Card.Content>
		<form method="POST" use:enhance>
			<Field.Group>
				{#if form?.message}
					<Alert.Root variant="destructive">
						<Alert.Description>{form.message}</Alert.Description>
					</Alert.Root>
				{/if}
				<Field.Field data-invalid={form?.fields?.key ? true : undefined}>
					<Field.Label for="key"
						>キー（英字で始まる2〜10文字。課題番号の接頭辞になり、後から変更できません）</Field.Label
					>
					<Input
						id="key"
						class="uppercase"
						name="key"
						required
						pattern="[A-Za-z][A-Za-z0-9]*"
						minlength={2}
						maxlength={10}
						aria-invalid={form?.fields?.key ? true : undefined}
					/>
					{#if form?.fields?.key}<Field.Error>{form.fields.key[0]}</Field.Error>{/if}
				</Field.Field>
				<Field.Field>
					<Field.Label for="name">プロジェクト名</Field.Label>
					<Input id="name" name="name" required maxlength={100} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="description">説明（Markdown）</Field.Label>
					<Textarea id="description" name="description" rows={4} />
				</Field.Field>
				<div><Button type="submit">作成</Button></div>
			</Field.Group>
		</form>
	</Card.Content>
</Card.Root>
