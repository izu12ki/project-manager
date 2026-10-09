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
		<Card.Title><h1 class="text-xl font-semibold">初期セットアップ</h1></Card.Title>
		<Card.Description>最初の管理者アカウントを作成します。</Card.Description>
	</Card.Header>
	<Card.Content>
		<form method="POST" use:enhance class="flex flex-col gap-6">
			{#if form?.message}<Alert.Root variant="destructive"
					><Alert.Description>{form.message}</Alert.Description></Alert.Root
				>{/if}
			<Field.Group>
				<Field.Field>
					<Field.Label for="name">名前</Field.Label>
					<Input id="name" name="name" required maxlength={50} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="email">メールアドレス</Field.Label>
					<Input id="email" name="email" type="email" autocomplete="email" required />
				</Field.Field>
				<Field.Field>
					<Field.Label for="password">パスワード（10文字以上）</Field.Label>
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
			<Button type="submit" class="w-full">セットアップを完了</Button>
		</form>
	</Card.Content>
</Card.Root>
