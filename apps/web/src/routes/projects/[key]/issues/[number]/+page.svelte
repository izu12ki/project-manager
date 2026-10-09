<script lang="ts">
	import { enhance } from '$app/forms';
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const issue = $derived(data.issue);
	const perms = $derived(data.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
</script>

<article class="space-y-6">
	<header>
		<p class="text-sm text-gray-500">{data.project.key}-{issue.number}</p>
		<h2 class="text-xl font-bold">{issue.title}</h2>
		<p class="text-xs text-gray-500">起票: {issue.reporterName}</p>
	</header>

	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}

	<form
		method="POST"
		action="?/update"
		use:enhance={() =>
			async ({ update, result }) => {
				await update({ reset: false });
				if (result.type === 'success') editing = false;
			}}
		class="card grid gap-4 md:grid-cols-4"
	>
		<label class="block text-sm">
			<span>ステータス</span>
			<select class="input" name="status" disabled={!perms.changeStatus}>
				{#each STATUSES as s (s)}<option value={s} selected={s === issue.status}
						>{STATUS_LABEL[s]}</option
					>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>優先度</span>
			<select class="input" name="priority" disabled={!perms.edit}>
				{#each PRIORITIES as p (p)}<option value={p} selected={p === issue.priority}
						>{PRIORITY_LABEL[p]}</option
					>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>担当者</span>
			<select class="input" name="assigneeId" disabled={!perms.assign}>
				<option value="">未割り当て</option>
				{#each data.assignees as u (u.id)}<option value={u.id} selected={u.id === issue.assigneeId}
						>{u.name}</option
					>{/each}
			</select>
		</label>
		<label class="block text-sm">
			<span>期限</span>
			<input
				class="input"
				type="date"
				name="dueDate"
				value={issue.dueDate ?? ''}
				disabled={!perms.edit}
			/>
		</label>
		{#if editing}
			<label class="block text-sm md:col-span-4">
				<span>タイトル</span>
				<input class="input" name="title" required maxlength="200" value={issue.title} />
			</label>
			<label class="block text-sm md:col-span-4">
				<span>説明（Markdown）</span>
				<textarea class="input" name="description" rows="10" value={issue.description}></textarea>
			</label>
		{/if}
		{#if canSave}
			<div class="flex gap-2 md:col-span-4">
				<button class="btn-primary">保存</button>
				{#if perms.edit && !editing}
					<button type="button" class="btn" onclick={() => (editing = true)}
						><Pencil size={14} />タイトル・説明を編集</button
					>
				{/if}
				{#if form?.saved}<span class="self-center text-sm text-green-700">保存しました</span>{/if}
			</div>
		{/if}
	</form>

	{#if !editing}
		<section class="card">
			{#if issue.description}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
				<div class="markdown">{@html issue.descriptionHtml}</div>
			{:else}
				<p class="text-sm text-gray-500">説明はありません。</p>
			{/if}
		</section>
	{/if}

	<section class="space-y-3">
		<h3 class="font-semibold">コメント</h3>
		{#each data.comments as c (c.id)}
			<div class="card">
				<p class="mb-1 text-xs text-gray-500">
					{c.authorName} · {c.createdAt.toLocaleString('ja-JP')}
				</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
				<div class="markdown">{@html c.html}</div>
				{#if c.canModify}
					<div class="mt-2 flex items-start gap-2">
						<details class="flex-1">
							<summary class="cursor-pointer text-xs text-gray-600">編集</summary>
							<form method="POST" action="?/editComment" use:enhance class="mt-2 space-y-2">
								<input type="hidden" name="commentId" value={c.id} />
								<textarea class="input" name="body" rows="4" required value={c.body}></textarea>
								<button class="btn">更新</button>
							</form>
						</details>
						<form
							method="POST"
							action="?/deleteComment"
							use:enhance={({ cancel }) => {
								if (!confirm('コメントを削除しますか？')) cancel();
							}}
						>
							<input type="hidden" name="commentId" value={c.id} />
							<button class="text-xs text-red-600">削除</button>
						</form>
					</div>
				{/if}
			</div>
		{/each}
		{#if perms.writable}
			<form method="POST" action="?/comment" use:enhance class="space-y-2">
				<label class="block text-sm">
					<span>コメントを追加</span>
					<textarea class="input" name="body" rows="4" required></textarea>
				</label>
				<button class="btn-primary">コメントする</button>
			</form>
		{/if}
	</section>

	{#if perms.delete}
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm('この課題を削除しますか？')) cancel();
			}}
		>
			<button class="btn text-red-600"><Trash2 size={14} />課題を削除</button>
		</form>
	{/if}
</article>
