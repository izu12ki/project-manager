<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import * as Password from '$lib/components/ui/password';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><h1 class="text-xl font-semibold">ログイン</h1></Card.Title>
	</Card.Header>
	<Card.Content>
		<form method="POST" use:enhance class="flex flex-col gap-6">
			{#if form?.message}<Alert.Root variant="destructive"
					><Alert.Description>{form.message}</Alert.Description></Alert.Root
				>{/if}
			<Field.Group>
				<Field.Field>
					<Field.Label for="email">メールアドレス</Field.Label>
					<Input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						value={form?.email ?? ''}
					/>
				</Field.Field>
				<Field.Field>
					<Field.Label for="password">パスワード</Field.Label>
					<Password.Root>
						<Password.Input id="password" name="password" autocomplete="current-password" required>
							<Password.ToggleVisibility />
						</Password.Input>
					</Password.Root>
				</Field.Field>
			</Field.Group>
			<Button type="submit" class="w-full">ログイン</Button>
		</form>
	</Card.Content>
	<Card.Footer>
		<a href="/forgot-password" class="text-sm text-muted-foreground underline"
			>パスワードを忘れた場合</a
		>
	</Card.Footer>
</Card.Root>
