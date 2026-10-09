<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import * as Password from '$lib/components/ui/password';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><h1 class="text-xl font-semibold">新しいパスワード</h1></Card.Title>
	</Card.Header>
	<Card.Content>
		{#if data.invalid || !data.token}
			<Alert.Root variant="destructive">
				<Alert.Description>
					リンクが無効か期限切れです。<a href="/forgot-password" class="underline"
						>もう一度やり直してください</a
					>。
				</Alert.Description>
			</Alert.Root>
		{:else}
			<form method="POST" use:enhance class="flex flex-col gap-6">
				{#if form?.message}<Alert.Root variant="destructive"
						><Alert.Description>{form.message}</Alert.Description></Alert.Root
					>{/if}
				<input type="hidden" name="token" value={data.token} />
				<Field.Group>
					<Field.Field>
						<Field.Label for="password">新しいパスワード（10文字以上）</Field.Label>
						<Password.Root>
							<Password.Input
								id="password"
								name="password"
								autocomplete="new-password"
								required
								minlength={10}
							>
								<Password.ToggleVisibility />
							</Password.Input>
						</Password.Root>
					</Field.Field>
				</Field.Group>
				<Button type="submit" class="w-full">パスワードを変更</Button>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
