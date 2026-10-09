<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import * as Password from '$lib/components/ui/password';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if !data.invitation}
	<Card.Root>
		<Card.Header>
			<Card.Title>招待リンクが無効です</Card.Title>
			<Card.Description>
				招待リンクが無効か、期限切れです。管理者に再発行を依頼してください。
			</Card.Description>
		</Card.Header>
	</Card.Root>
{:else}
	<Card.Root>
		<Card.Header>
			<Card.Title>アカウント登録</Card.Title>
			<Card.Description>
				{data.invitation.email} を{data.invitation
					.roleLabel}として登録します{#if data.invitation.projectName}（プロジェクト: {data
						.invitation.projectName}）{/if}。
			</Card.Description>
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
				<Button type="submit" class="w-full">登録する</Button>
			</form>
		</Card.Content>
	</Card.Root>
{/if}
