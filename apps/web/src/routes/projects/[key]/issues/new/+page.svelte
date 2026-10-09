<script lang="ts">
	import { enhance } from '$app/forms';
	import { PRIORITIES, PRIORITY_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h2 class="mb-4 text-xl font-bold">新規課題</h2>
<form method="POST" use:enhance class="card max-w-2xl space-y-4">
	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
	<label class="block">
		<span class="text-sm">タイトル</span>
		<input class="input" name="title" required maxlength="200" />
	</label>
	<label class="block">
		<span class="text-sm">説明（Markdown）</span>
		<textarea class="input" name="description" rows="8"></textarea>
	</label>
	<div class="grid gap-4 md:grid-cols-3">
		<label class="block">
			<span class="text-sm">優先度</span>
			<select class="input" name="priority">
				{#each PRIORITIES as p (p)}<option value={p}>{PRIORITY_LABEL[p]}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span class="text-sm">期限</span>
			<input class="input" type="date" name="dueDate" />
		</label>
		{#if data.canAssign}
			<label class="block">
				<span class="text-sm">担当者</span>
				<select class="input" name="assigneeId">
					<option value="">未割り当て</option>
					{#each data.assignees as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
			</label>
		{/if}
	</div>
	<button class="btn-primary">起票する</button>
</form>
