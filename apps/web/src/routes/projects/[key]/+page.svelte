<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-4 flex flex-wrap items-end gap-2">
	<form method="GET" class="flex flex-wrap items-end gap-2 text-sm">
		<label class="block">
			<span>ステータス</span>
			<select class="input" name="status">
				<option value="">すべて</option>
				{#each STATUSES as s (s)}<option value={s} selected={data.filters.status === s}
						>{STATUS_LABEL[s]}</option
					>{/each}
			</select>
		</label>
		<label class="block">
			<span>担当者</span>
			<select class="input" name="assignee">
				<option value="">すべて</option>
				<option value="none" selected={data.filters.assigneeId === 'none'}>未割り当て</option>
				{#each data.assignees as u (u.id)}<option
						value={u.id}
						selected={data.filters.assigneeId === u.id}>{u.name}</option
					>{/each}
			</select>
		</label>
		<label class="block">
			<span>優先度</span>
			<select class="input" name="priority">
				<option value="">すべて</option>
				{#each PRIORITIES as p (p)}<option value={p} selected={data.filters.priority === p}
						>{PRIORITY_LABEL[p]}</option
					>{/each}
			</select>
		</label>
		<button class="btn">絞り込み</button>
	</form>
	{#if !data.project.archivedAt}
		<a href={`/projects/${data.project.key}/issues/new`} class="btn-primary ml-auto"
			><Plus size={16} />新規課題</a
		>
	{/if}
</div>

{#if data.issues.length === 0}
	<p class="text-sm text-gray-600">課題はありません。</p>
{:else}
	<table class="w-full bg-white text-sm">
		<thead class="text-left text-gray-500">
			<tr
				><th class="p-2">番号</th><th class="p-2">タイトル</th><th class="p-2">ステータス</th><th
					class="p-2">優先度</th
				><th class="p-2">担当者</th><th class="p-2">期限</th></tr
			>
		</thead>
		<tbody>
			{#each data.issues as i (i.id)}
				<tr class="border-t border-gray-200">
					<td class="p-2 text-gray-500">{data.project.key}-{i.number}</td>
					<td class="p-2"
						><a
							href={`/projects/${data.project.key}/issues/${i.number}`}
							class="text-blue-700 hover:underline">{i.title}</a
						></td
					>
					<td class="p-2">{STATUS_LABEL[i.status]}</td>
					<td class="p-2">{PRIORITY_LABEL[i.priority]}</td>
					<td class="p-2">{i.assigneeName ?? '—'}</td>
					<td class="p-2">{i.dueDate ?? '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
