<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><h1 class="text-xl font-semibold">パスワードの再設定</h1></Card.Title>
	</Card.Header>
	<Card.Content>
		{#if form?.sent}
			<Alert.Root>
				<Alert.Description>
					登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールを確認してください。
				</Alert.Description>
			</Alert.Root>
		{:else}
			<form method="POST" use:enhance class="flex flex-col gap-6">
				{#if form?.message}<Alert.Root variant="destructive"
						><Alert.Description>{form.message}</Alert.Description></Alert.Root
					>{/if}
				<Field.Group>
					<Field.Field>
						<Field.Label for="email">メールアドレス</Field.Label>
						<Input id="email" name="email" type="email" autocomplete="email" required />
					</Field.Field>
				</Field.Group>
				<Button type="submit" class="w-full">再設定リンクを送る</Button>
			</form>
		{/if}
	</Card.Content>
	<Card.Footer>
		<a href="/login" class="text-sm text-muted-foreground underline">ログインに戻る</a>
	</Card.Footer>
</Card.Root>
