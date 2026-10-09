<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	$effect(() => {
		if (form?.saved) toast.success('保存しました');
	});
</script>

<div class="flex flex-col gap-6">
	{#if form?.message}
		<Alert.Root variant="destructive">
			<Alert.Description>{form.message}</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid gap-6 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>プロジェクト情報</Card.Title>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/update"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<Field.Group>
						<Field.Field>
							<Field.Label for="project-name">プロジェクト名</Field.Label>
							<Input
								id="project-name"
								name="name"
								required
								maxlength={100}
								value={data.project.name}
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="project-description">説明（Markdown）</Field.Label>
							<Textarea
								id="project-description"
								name="description"
								rows={4}
								value={data.project.description}
							/>
						</Field.Field>
						<div><Button type="submit">保存</Button></div>
					</Field.Group>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>ゲストを招待</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form method="POST" action="?/inviteGuest" use:enhance class="flex items-end gap-2">
					<Field.Field class="flex-1">
						<Field.Label for="guest-email">ゲストのメールアドレス</Field.Label>
						<Input id="guest-email" name="email" type="email" required />
					</Field.Field>
					<Button type="submit">ゲストを招待</Button>
				</form>
				{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
				{#each data.invitations as inv (inv.id)}
					<div class="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
						<span>{inv.email}</span>
						{#if inv.expired}<Badge variant="destructive">期限切れ</Badge>{/if}
						<div class="ml-auto flex flex-wrap items-center gap-2">
							<form method="POST" action="?/reissue" use:enhance class="flex items-center gap-2">
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
					</div>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root class="md:col-span-2">
			<Card.Header>
				<Card.Title>参加者</Card.Title>
				<Card.Description>管理者は全プロジェクトに参加しています。</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>名前</Table.Head>
							<Table.Head>ロール</Table.Head>
							<Table.Head>操作</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.members as m (m.id)}
							<Table.Row>
								<Table.Cell>{m.name}</Table.Cell>
								<Table.Cell><Badge variant="outline">{ROLE_LABEL[m.role]}</Badge></Table.Cell>
								<Table.Cell>
									<ConfirmAction
										action="?/removeMember"
										fields={{ id: m.id }}
										title={`${m.name} をプロジェクトから外しますか？`}
										description="担当している課題は未割り当てになります。"
										confirmLabel="外す"
										triggerVariant="ghost"
									>
										{#snippet trigger()}外す{/snippet}
									</ConfirmAction>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
				{#if data.candidates.length > 0}
					<form method="POST" action="?/addMember" use:enhance class="flex items-end gap-2">
						<Field.Field class="flex-1">
							<Field.Label for="add-member">追加するユーザー</Field.Label>
							<NativeSelect.Root id="add-member" name="id">
								{#each data.candidates as u (u.id)}
									<NativeSelect.Option value={u.id}>
										{u.name}（{ROLE_LABEL[u.role]}）
									</NativeSelect.Option>
								{/each}
							</NativeSelect.Root>
						</Field.Field>
						<Button type="submit" variant="outline">追加</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="md:col-span-2">
			<Card.Header>
				<Card.Title>アーカイブ</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if data.project.archivedAt}
					<form method="POST" action="?/archive" use:enhance>
						<input type="hidden" name="archived" value="false" />
						<Button type="submit" variant="outline">アーカイブを解除</Button>
					</form>
				{:else}
					<ConfirmAction
						action="?/archive"
						fields={{ archived: 'true' }}
						title="このプロジェクトをアーカイブしますか？"
						description="アーカイブ中は閲覧のみになります。"
						confirmLabel="アーカイブする"
					>
						{#snippet trigger()}アーカイブする{/snippet}
					</ConfirmAction>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
