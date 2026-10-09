<script lang="ts">
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import { PRIORITIES, PRIORITY_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<section class="grid w-full max-w-[720px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">新規課題</h1>
		<p class="page-desc">{data.project.name}（{data.project.key}）</p>
	</div>
	<form method="POST" use:enhance class="card">
		{#if form?.message}<FormAlert message={form.message} />{/if}
		<div class="field">
			<label class="label" for="issue-title">タイトル</label>
			<input class="input" id="issue-title" name="title" required maxlength={200} />
		</div>
		<div class="field">
			<label class="label" for="issue-description">本文</label>
			<textarea
				class="textarea"
				id="issue-description"
				name="description"
				rows="6"
				aria-describedby="issue-description-hint"></textarea>
			<p class="hint" id="issue-description-hint">Markdown が使えます</p>
		</div>
		<div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
			<div class="field">
				<label class="label" for="issue-priority">優先度</label>
				<select class="select" id="issue-priority" name="priority">
					{#each PRIORITIES as p (p)}
						<option value={p}>{PRIORITY_LABEL[p]}</option>
					{/each}
				</select>
			</div>
			{#if data.canAssign}
				<div class="field">
					<label class="label" for="issue-assignee">担当者</label>
					<select class="select" id="issue-assignee" name="assigneeId">
						<option value="">未割り当て</option>
						{#each data.assignees as u (u.id)}
							<option value={u.id}>{u.name}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="field">
				<label class="label" for="issue-due-date">期限</label>
				<input class="input" id="issue-due-date" type="date" name="dueDate" />
			</div>
		</div>
		<div class="flex justify-end gap-2">
			<a href={`/projects/${data.project.key}`} class="btn btn-outline">キャンセル</a>
			<button type="submit" class="btn btn-primary">起票する</button>
		</div>
	</form>
</section>
