<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import * as Password from '$lib/components/ui/password';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	$effect(() => {
		if (form?.nameSaved) toast.success('保存しました');
	});
	$effect(() => {
		if (form?.passwordSaved)
			toast.success('パスワードを変更しました。他の端末はログアウトされます');
	});
</script>

<h1 class="mb-6 text-2xl font-bold">アカウント</h1>

<div class="flex flex-col gap-6">
	{#if form?.message}
		<Alert.Root variant="destructive">
			<Alert.Description>{form.message}</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid gap-6 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>表示名</Card.Title>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/updateName" use:enhance class="flex flex-col gap-6">
					<Field.Group>
						<Field.Field>
							<Field.Label for="account-name">名前</Field.Label>
							<Input
								id="account-name"
								name="name"
								required
								maxlength={50}
								value={data.user?.name}
							/>
						</Field.Field>
					</Field.Group>
					<Button type="submit" class="self-start">保存</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>パスワード変更</Card.Title>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/changePassword" use:enhance class="flex flex-col gap-6">
					<Field.Group>
						<Field.Field>
							<Field.Label for="current-password">現在のパスワード</Field.Label>
							<Password.Root>
								<Password.Input
									id="current-password"
									name="currentPassword"
									autocomplete="current-password"
									required
								>
									<Password.ToggleVisibility />
								</Password.Input>
							</Password.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label for="new-password">新しいパスワード（10文字以上）</Field.Label>
							<Password.Root>
								<Password.Input
									id="new-password"
									name="newPassword"
									autocomplete="new-password"
									required
									minlength={10}
								>
									<Password.ToggleVisibility />
								</Password.Input>
							</Password.Root>
						</Field.Field>
					</Field.Group>
					<Button type="submit" class="self-start">変更</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</div>
