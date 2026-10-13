<script lang="ts">
	import { enhance } from '$app/forms';
	import { UserRoundCheck } from '@lucide/svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, milestoneLabel } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const cancelHref = $derived(`/projects/${data.project.key}`);
	let assigneeId = $state('');
	const meAssignable = $derived(data.assignees.some((u) => u.id === data.user?.id));
</script>

{#snippet actions()}
	<div class="flex justify-end gap-2">
		<a href={cancelHref} class="btn btn-secondary">キャンセル</a>
		<button type="submit" class="btn btn-primary min-w-24 font-bold">起票する</button>
	</div>
{/snippet}

<form method="POST" use:enhance class="grid gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="m-0 text-lg leading-snug font-bold">新規課題</h1>
		{@render actions()}
	</div>
	{#if form?.message}<FormAlert message={form.message} />{/if}
	<label for="issue-title" class="sr-only">タイトル</label>
	<input
		class="input title"
		id="issue-title"
		name="title"
		placeholder="タイトル"
		required
		maxlength={200}
	/>
	<div class="sheet">
		<label for="issue-description" class="sr-only">本文</label>
		<MarkdownEditor
			id="issue-description"
			name="description"
			rows={10}
			placeholder="課題の詳細"
			projectKey={data.project.key}
		/>
		<div class="props">
			<div class="prop-list prop-list-wide">
				{#if data.canSetStatus}
					<div class="prop-row">
						<label for="issue-status">ステータス</label>
						<select class="select" id="issue-status" name="status">
							{#each STATUSES as s (s)}
								<option value={s}>{STATUS_LABEL[s]}</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="prop-row">
					<label for="issue-priority">優先度</label>
					<select class="select" id="issue-priority" name="priority">
						{#each PRIORITIES as p (p)}
							<option value={p} selected={p === 'medium'}>{PRIORITY_LABEL[p]}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-category">カテゴリー</label>
					<select class="select" id="issue-category" name="categoryId">
						<option value="">未設定</option>
						{#each data.categories as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-start-date">開始日</label>
					<div><input class="input" id="issue-start-date" type="date" name="startDate" /></div>
				</div>
			</div>
			<div class="prop-list prop-list-wide">
				{#if data.canAssign}
					<div class="prop-row">
						<label for="issue-assignee">担当者</label>
						<div class="flex flex-wrap items-center gap-2">
							<select class="select" id="issue-assignee" name="assigneeId" bind:value={assigneeId}>
								<option value="">未割当</option>
								{#each data.assignees as u (u.id)}
									<option value={u.id}>{u.name}</option>
								{/each}
							</select>
							{#if meAssignable}
								<button
									type="button"
									class="assign-me"
									onclick={() => (assigneeId = data.user?.id ?? '')}
								>
									<UserRoundCheck size={14} />私が担当
								</button>
							{/if}
						</div>
					</div>
				{/if}
				<div class="prop-row">
					<label for="issue-milestone">マイルストーン</label>
					<select class="select" id="issue-milestone" name="milestoneId">
						<option value="">未設定</option>
						{#each data.milestones as m (m.id)}
							<option value={m.id}>{milestoneLabel(m)}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-due-date">期限日</label>
					<div><input class="input" id="issue-due-date" type="date" name="dueDate" /></div>
				</div>
			</div>
		</div>
	</div>
	<div class="pt-2">{@render actions()}</div>
</form>

<style>
	.title {
		background: var(--card);
		font-size: 15px;
		height: 36px;
	}
	.sheet {
		display: grid;
		gap: 16px;
		padding: 16px 20px 20px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--card);
	}
	.props {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		column-gap: 40px;
	}
	.assign-me {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--card);
		font-size: 13px;
		cursor: pointer;
	}
	.assign-me:hover {
		background: var(--accent);
	}
</style>
