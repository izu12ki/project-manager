<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import * as Field from '$lib/components/ui/field';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as Table from '$lib/components/ui/table';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const priorityVariant = (p: string) =>
		p === 'urgent' ? 'destructive' : p === 'high' ? 'default' : 'outline';
</script>

<div class="mb-4 flex flex-wrap items-end gap-2">
	<form method="GET" class="flex flex-wrap items-end gap-2">
		<Field.Field class="w-auto">
			<Field.Label for="filter-status">ステータス</Field.Label>
			<NativeSelect.Root id="filter-status" name="status">
				<NativeSelect.Option value="">すべて</NativeSelect.Option>
				{#each STATUSES as s (s)}
					<NativeSelect.Option value={s} selected={data.filters.status === s}
						>{STATUS_LABEL[s]}</NativeSelect.Option
					>
				{/each}
			</NativeSelect.Root>
		</Field.Field>
		<Field.Field class="w-auto">
			<Field.Label for="filter-assignee">担当者</Field.Label>
			<NativeSelect.Root id="filter-assignee" name="assignee">
				<NativeSelect.Option value="">すべて</NativeSelect.Option>
				<NativeSelect.Option value="none" selected={data.filters.assigneeId === 'none'}
					>未割り当て</NativeSelect.Option
				>
				{#each data.assignees as u (u.id)}
					<NativeSelect.Option value={u.id} selected={data.filters.assigneeId === u.id}
						>{u.name}</NativeSelect.Option
					>
				{/each}
			</NativeSelect.Root>
		</Field.Field>
		<Field.Field class="w-auto">
			<Field.Label for="filter-priority">優先度</Field.Label>
			<NativeSelect.Root id="filter-priority" name="priority">
				<NativeSelect.Option value="">すべて</NativeSelect.Option>
				{#each PRIORITIES as p (p)}
					<NativeSelect.Option value={p} selected={data.filters.priority === p}
						>{PRIORITY_LABEL[p]}</NativeSelect.Option
					>
				{/each}
			</NativeSelect.Root>
		</Field.Field>
		<Button type="submit" variant="outline">絞り込み</Button>
	</form>
	{#if !data.project.archivedAt}
		<Button href={`/projects/${data.project.key}/issues/new`} class="ml-auto">
			<Plus data-icon="inline-start" />新規課題
		</Button>
	{/if}
</div>

{#if data.issues.length === 0}
	<Empty.Root>
		<Empty.Header>
			<Empty.Title>課題はありません</Empty.Title>
		</Empty.Header>
	</Empty.Root>
{:else}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>番号</Table.Head>
				<Table.Head>タイトル</Table.Head>
				<Table.Head>ステータス</Table.Head>
				<Table.Head>優先度</Table.Head>
				<Table.Head>担当者</Table.Head>
				<Table.Head>期限</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.issues as i (i.id)}
				<Table.Row>
					<Table.Cell class="text-muted-foreground">{data.project.key}-{i.number}</Table.Cell>
					<Table.Cell>
						<a href={`/projects/${data.project.key}/issues/${i.number}`} class="hover:underline"
							>{i.title}</a
						>
					</Table.Cell>
					<Table.Cell><Badge variant="secondary">{STATUS_LABEL[i.status]}</Badge></Table.Cell>
					<Table.Cell>
						<Badge variant={priorityVariant(i.priority)}>{PRIORITY_LABEL[i.priority]}</Badge>
					</Table.Cell>
					<Table.Cell>{i.assigneeName ?? '—'}</Table.Cell>
					<Table.Cell>{i.dueDate ?? '—'}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
