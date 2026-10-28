<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { UserRoundCheck } from '@lucide/svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import MultiSelect from '$lib/components/MultiSelect.svelte';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { PRIORITIES, PRIORITY_LABEL, milestoneLabel } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const cancelHref = $derived(
		`/projects/${data.project.key}${data.parent ? `/issues/${data.parent.number}` : ''}`
	);
	let assigneeIds = $state<string[]>([]);
	const meAssignable = $derived(data.assignees.some((u) => u.id === data.user?.id));
	const templateOf = (id: string | undefined) =>
		data.issueTypes.find((t) => t.id === id)?.template ?? '';
	// 入力中にデータが取り直されても本文を上書きしないよう、初期値だけ取る
	let typeId = $state(untrack(() => data.issueTypes[0]?.id));
	let description = $state(untrack(() => templateOf(data.issueTypes[0]?.id)));

	/** 本文が空か、前の種別のテンプレートのままなら、選んだ種別のテンプレートに入れ替える */
	function changeType(next: string) {
		const prev = templateOf(typeId);
		if (description.trim() === '' || description.trim() === prev.trim()) {
			description = templateOf(next);
		}
		typeId = next;
	}
</script>

{#snippet actions()}
	<div class="flex justify-end gap-2">
		<a href={cancelHref} class="btn btn-secondary">キャンセル</a>
		<button type="submit" class="btn btn-primary min-w-24 font-bold">起票する</button>
	</div>
{/snippet}

<form method="POST" use:enhance class="grid gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="m-0 text-lg leading-snug font-bold">
			{data.parent ? '子課題を追加' : '新規課題'}
			{#if data.parent}
				<span class="block text-[13px] font-normal text-muted-foreground"
					>親課題: {data.project.key}-{data.parent.number} {data.parent.title}</span
				>
			{/if}
		</h1>
		{@render actions()}
	</div>
	{#if form?.message}<FormAlert message={form.message} />{/if}
	{#if data.issueTypes.length > 0}
		<div class="flex items-center gap-2">
			<label for="issue-type" class="text-[13px] text-muted-foreground">種別</label>
			<select
				class="select type-select"
				id="issue-type"
				name="typeId"
				value={typeId}
				onchange={(e) => changeType(e.currentTarget.value)}
			>
				{#each data.issueTypes as t (t.id)}
					<option value={t.id}>{t.name}</option>
				{/each}
			</select>
		</div>
	{/if}
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
			bind:value={description}
			label="本文"
			rows={10}
			placeholder="課題の詳細"
			projectKey={data.project.key}
			mentionCandidates={data.mentionCandidates}
		/>
		<div class="props">
			<div class="prop-list prop-list-wide">
				{#if data.canSetStatus}
					<div class="prop-row">
						<label for="issue-status">ステータス</label>
						<select class="select" id="issue-status" name="status">
							{#each data.statuses as s (s.key)}
								<option value={s.key}>{s.name}</option>
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
						<span class="prop-label" id="issue-assignee-label">担当者</span>
						<div class="flex flex-wrap items-center gap-2">
							<div class="assignees">
								<MultiSelect
									id="issue-assignee"
									name="assigneeIds"
									options={data.assignees.map((u) => ({ value: u.id, label: u.name }))}
									bind:selected={assigneeIds}
									placeholder="未割当"
								/>
							</div>
							{#if meAssignable && data.user && !assigneeIds.includes(data.user.id)}
								<button
									type="button"
									class="assign-me"
									onclick={() => data.user && (assigneeIds = [...assigneeIds, data.user.id])}
								>
									<UserRoundCheck size={14} />私が担当
								</button>
							{/if}
						</div>
					</div>
				{/if}
				<div class="prop-row">
					<label for="issue-parent">親課題</label>
					<div>
						<input
							class="input parent"
							id="issue-parent"
							name="parentNumber"
							list="issue-parent-options"
							inputmode="numeric"
							placeholder="課題番号"
							value={data.parent ? String(data.parent.number) : ''}
						/>
						<datalist id="issue-parent-options">
							{#each data.parentCandidates as c (c.number)}
								<option value={String(c.number)}>{data.project.key}-{c.number} {c.title}</option>
							{/each}
						</datalist>
					</div>
				</div>
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
	.type-select {
		width: auto;
		min-width: 140px;
	}
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
		border-radius: var(--radius-md);
		background: var(--card);
	}
	.props {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		column-gap: 40px;
	}
	.assignees {
		width: 240px;
		max-width: 100%;
	}
	.parent {
		max-width: 160px;
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
