<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Empty from '$lib/components/ui/empty';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as Table from '$lib/components/ui/table';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">ユーザー</h1>
<div class="flex flex-col gap-8">
	{#if form?.message}
		<Alert.Root variant="destructive">
			<Alert.Description>{form.message}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title><h2 class="text-base font-medium">招待</h2></Card.Title>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<form method="POST" action="?/invite" use:enhance>
				<Field.Group class="md:grid md:grid-cols-4 md:items-end">
					<Field.Field class="md:col-span-2">
						<Field.Label for="invite-email">メールアドレス</Field.Label>
						<Input id="invite-email" name="email" type="email" required />
					</Field.Field>
					<Field.Field>
						<Field.Label for="invite-role">ロール</Field.Label>
						<NativeSelect.Root id="invite-role" name="role">
							<NativeSelect.Option value="member">メンバー</NativeSelect.Option>
							<NativeSelect.Option value="guest">ゲスト</NativeSelect.Option>
						</NativeSelect.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label for="invite-project">参加プロジェクト（ゲストは必須）</Field.Label>
						<NativeSelect.Root id="invite-project" name="projectId">
							<NativeSelect.Option value="">なし</NativeSelect.Option>
							{#each data.projects as p (p.id)}
								<NativeSelect.Option value={p.id}>{p.name}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</Field.Field>
					<div class="md:col-span-4"><Button type="submit">招待する</Button></div>
				</Field.Group>
			</form>
			{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title><h2 class="text-base font-medium">未使用の招待</h2></Card.Title>
		</Card.Header>
		<Card.Content>
			{#if data.invitations.length === 0}
				<Empty.Root>
					<Empty.Header>
						<Empty.Title>未使用の招待はありません</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>メール</Table.Head>
							<Table.Head>ロール・プロジェクト</Table.Head>
							<Table.Head>状態</Table.Head>
							<Table.Head>操作</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.invitations as inv (inv.id)}
							<Table.Row>
								<Table.Cell>{inv.email}</Table.Cell>
								<Table.Cell class="text-muted-foreground"
									>{ROLE_LABEL[inv.role]}{inv.projectName
										? ` / ${inv.projectName}`
										: ''}</Table.Cell
								>
								<Table.Cell>
									{#if inv.expired}
										<Badge variant="destructive">期限切れ</Badge>
									{:else}
										<Badge variant="secondary">有効</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap items-center gap-2">
										<form
											method="POST"
											action="?/reissue"
											use:enhance
											class="flex items-center gap-2"
										>
											<input type="hidden" name="id" value={inv.id} />
											<Button type="submit" variant="outline" size="sm">リンクをコピー</Button>
											<span class="text-xs text-muted-foreground"
												>コピーすると招待を再発行し、以前のリンクは無効になります</span
											>
										</form>
										<ConfirmAction
											action="?/revoke"
											fields={{ id: inv.id }}
											title="この招待を取り消しますか？"
											confirmLabel="取り消す"
										>
											{#snippet trigger()}取り消し{/snippet}
										</ConfirmAction>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title><h2 class="text-base font-medium">登録済みユーザー</h2></Card.Title>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>名前</Table.Head>
						<Table.Head>メール</Table.Head>
						<Table.Head>ロール</Table.Head>
						<Table.Head>状態・操作</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.users as u (u.id)}
						<Table.Row>
							<Table.Cell>{u.name}</Table.Cell>
							<Table.Cell>{u.email}</Table.Cell>
							<Table.Cell><Badge variant="outline">{ROLE_LABEL[u.role]}</Badge></Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-2">
									{#if u.disabledAt}
										<Badge variant="secondary">無効</Badge>
										<form method="POST" action="?/enable" use:enhance>
											<input type="hidden" name="id" value={u.id} />
											<Button type="submit" variant="outline" size="sm">有効化</Button>
										</form>
									{:else if u.id !== data.user?.id}
										<ConfirmAction
											action="?/disable"
											fields={{ id: u.id }}
											title={`${u.name} を無効化しますか？`}
											description="すぐにログアウトされます。"
											confirmLabel="無効化する"
										>
											{#snippet trigger()}無効化{/snippet}
										</ConfirmAction>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
