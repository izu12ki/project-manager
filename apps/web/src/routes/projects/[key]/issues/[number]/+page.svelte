<script lang="ts">
	import { enhance } from '$app/forms';
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '$lib/components/ui/alert';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { Textarea } from '$lib/components/ui/textarea';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const issue = $derived(data.issue);
	const perms = $derived(data.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
	const attrFormId = 'issue-attributes';

	$effect(() => {
		if (form?.saved) toast.success('保存しました');
	});
	$effect(() => {
		if (form?.commented) toast.success('コメントしました');
	});
</script>

<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
	<div class="flex min-w-0 flex-col gap-6">
		<header class="flex flex-col gap-1">
			<p class="text-sm text-muted-foreground">{data.project.key}-{issue.number}</p>
			<h2 class="text-xl font-bold">{issue.title}</h2>
			<p class="text-xs text-muted-foreground">起票: {issue.reporterName}</p>
		</header>

		{#if form?.message}
			<Alert.Root variant="destructive">
				<Alert.Description>{form.message}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if editing}
			<!-- title/description は右列の属性フォーム(id=issue-attributes)に form 属性で紐づけ、編集中だけ送信される -->
			<Card.Root>
				<Card.Content>
					<Field.Group>
						<Field.Field>
							<Field.Label for="issue-title">タイトル</Field.Label>
							<Input
								id="issue-title"
								name="title"
								form={attrFormId}
								required
								maxlength={200}
								value={issue.title}
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="issue-description">説明（Markdown）</Field.Label>
							<Textarea
								id="issue-description"
								name="description"
								form={attrFormId}
								rows={10}
								value={issue.description}
							/>
						</Field.Field>
					</Field.Group>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Content>
					{#if issue.description}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
						<div class="markdown">{@html issue.descriptionHtml}</div>
					{:else}
						<p class="text-sm text-muted-foreground">説明はありません。</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<section class="flex flex-col gap-3">
			<h3 class="font-semibold">コメント</h3>
			{#each data.comments as c (c.id)}
				<Card.Root>
					<Card.Header>
						<Card.Description>
							{c.authorName} · {c.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
						</Card.Description>
					</Card.Header>
					<Card.Content class="flex flex-col gap-3">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
						<div class="markdown">{@html c.html}</div>
						{#if c.canModify}
							<div class="flex items-start gap-2">
								<Collapsible.Root class="flex-1">
									<Collapsible.Trigger class={buttonVariants({ variant: 'ghost', size: 'sm' })}>
										編集
									</Collapsible.Trigger>
									<Collapsible.Content>
										<form
											method="POST"
											action="?/editComment"
											use:enhance
											class="mt-2 flex flex-col gap-2"
										>
											<input type="hidden" name="commentId" value={c.id} />
											<Textarea
												name="body"
												rows={4}
												required
												value={c.body}
												aria-label="コメントを編集"
											/>
											<div>
												<Button type="submit" variant="outline" size="sm">更新</Button>
											</div>
										</form>
									</Collapsible.Content>
								</Collapsible.Root>
								<ConfirmAction
									action="?/deleteComment"
									fields={{ commentId: c.id }}
									title="コメントを削除しますか？"
									confirmLabel="削除する"
									triggerVariant="ghost"
								>
									{#snippet trigger()}削除{/snippet}
								</ConfirmAction>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			{/each}
			{#if perms.writable}
				<form method="POST" action="?/comment" use:enhance class="flex flex-col gap-3">
					<Field.Field>
						<Field.Label for="new-comment">コメントを追加</Field.Label>
						<Textarea id="new-comment" name="body" rows={4} required />
					</Field.Field>
					<div>
						<Button type="submit">コメントする</Button>
					</div>
				</form>
			{/if}
		</section>

		{#if perms.delete}
			<div>
				<ConfirmAction
					action="?/delete"
					title="この課題を削除しますか？"
					description="コメントも削除されます。元に戻せません。"
					confirmLabel="削除する"
					triggerVariant="destructive"
				>
					{#snippet trigger()}<Trash2 data-icon="inline-start" />課題を削除{/snippet}
				</ConfirmAction>
			</div>
		{/if}
	</div>

	<aside>
		<form
			id={attrFormId}
			method="POST"
			action="?/update"
			use:enhance={() =>
				async ({ update, result }) => {
					await update({ reset: false });
					if (result.type === 'success') editing = false;
				}}
		>
			<Card.Root>
				<Card.Header>
					<Card.Title>属性</Card.Title>
				</Card.Header>
				<Card.Content>
					<Field.Group>
						<Field.Field>
							<Field.Label for="issue-status">ステータス</Field.Label>
							<NativeSelect.Root id="issue-status" name="status" disabled={!perms.changeStatus}>
								{#each STATUSES as s (s)}
									<NativeSelect.Option value={s} selected={s === issue.status}
										>{STATUS_LABEL[s]}</NativeSelect.Option
									>
								{/each}
							</NativeSelect.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label for="issue-priority">優先度</Field.Label>
							<NativeSelect.Root id="issue-priority" name="priority" disabled={!perms.edit}>
								{#each PRIORITIES as p (p)}
									<NativeSelect.Option value={p} selected={p === issue.priority}
										>{PRIORITY_LABEL[p]}</NativeSelect.Option
									>
								{/each}
							</NativeSelect.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label for="issue-assignee">担当者</Field.Label>
							<NativeSelect.Root id="issue-assignee" name="assigneeId" disabled={!perms.assign}>
								<NativeSelect.Option value="">未割り当て</NativeSelect.Option>
								{#each data.assignees as u (u.id)}
									<NativeSelect.Option value={u.id} selected={u.id === issue.assigneeId}
										>{u.disabled ? `${u.name}（無効）` : u.name}</NativeSelect.Option
									>
								{/each}
							</NativeSelect.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label for="issue-due">期限</Field.Label>
							<Input
								id="issue-due"
								type="date"
								name="dueDate"
								value={issue.dueDate ?? ''}
								disabled={!perms.edit}
							/>
						</Field.Field>
					</Field.Group>
				</Card.Content>
				{#if canSave || (perms.edit && !editing)}
					<Card.Footer class="flex flex-wrap gap-2">
						{#if canSave}
							<Button type="submit">保存</Button>
						{/if}
						{#if perms.edit && !editing}
							<Button type="button" variant="outline" onclick={() => (editing = true)}>
								<Pencil data-icon="inline-start" />タイトル・説明を編集
							</Button>
						{/if}
					</Card.Footer>
				{/if}
			</Card.Root>
		</form>
	</aside>
</div>
