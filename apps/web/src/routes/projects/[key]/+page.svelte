<script lang="ts">
	import { Inbox, SearchX } from '@lucide/svelte';
	import PriorityPill from '$lib/components/PriorityPill.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import {
		PRIORITIES,
		PRIORITY_LABEL,
		STATUSES,
		STATUS_LABEL,
		formatDue,
		isDueAlert
	} from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const filtering = $derived(
		!!(data.filters.status || data.filters.priority || data.filters.assigneeId)
	);
</script>

<section class="grid gap-4">
	<form
		method="GET"
		class="flex flex-wrap items-end gap-3"
		onchange={(e) => e.currentTarget.requestSubmit()}
	>
		<div class="field w-40 gap-1.5">
			<label class="label text-[13px]" for="filter-status">ステータス</label>
			<select class="select" id="filter-status" name="status">
				<option value="">すべて</option>
				{#each STATUSES as s (s)}
					<option value={s} selected={data.filters.status === s}>{STATUS_LABEL[s]}</option>
				{/each}
			</select>
		</div>
		<div class="field w-36 gap-1.5">
			<label class="label text-[13px]" for="filter-priority">優先度</label>
			<select class="select" id="filter-priority" name="priority">
				<option value="">すべて</option>
				{#each PRIORITIES as p (p)}
					<option value={p} selected={data.filters.priority === p}>{PRIORITY_LABEL[p]}</option>
				{/each}
			</select>
		</div>
		<div class="field w-40 gap-1.5">
			<label class="label text-[13px]" for="filter-assignee">担当者</label>
			<select class="select" id="filter-assignee" name="assignee">
				<option value="">すべて</option>
				<option value="none" selected={data.filters.assigneeId === 'none'}>未割り当て</option>
				{#each data.assignees as u (u.id)}
					<option value={u.id} selected={data.filters.assigneeId === u.id}>{u.name}</option>
				{/each}
			</select>
		</div>
		<noscript><button type="submit" class="btn btn-outline">絞り込む</button></noscript>
		<span class="ml-auto pb-2 text-[13px] text-muted-foreground">{data.issues.length} 件</span>
	</form>

	{#if data.issues.length === 0}
		<div class="empty">
			<span class="empty-icon"
				>{#if filtering}<SearchX />{:else}<Inbox />{/if}</span
			>
			<div class="grid gap-1">
				<div class="empty-title">
					{filtering ? '条件に一致する課題はありません' : '課題はまだありません'}
				</div>
				<div class="text-muted-foreground">
					{filtering
						? '絞り込み条件を変更してください'
						: data.project.archivedAt
							? 'このプロジェクトはアーカイブ済みです'
							: '右上の「新規課題」から起票できます'}
				</div>
			</div>
			{#if filtering}<a href={base} class="btn btn-outline">絞り込みを解除</a>{/if}
		</div>
	{:else}
		<div class="grid-table" style="--cols: 96px minmax(240px, 1fr) 120px 80px 140px 88px">
			<div role="table" aria-label="課題一覧" style="min-width: 760px">
				<div role="row" class="grid-table-head">
					<span role="columnheader">キー</span>
					<span role="columnheader">タイトル</span>
					<span role="columnheader">ステータス</span>
					<span role="columnheader">優先度</span>
					<span role="columnheader">担当者</span>
					<span role="columnheader">期限</span>
				</div>
				{#each data.issues as i (i.id)}
					<div role="row" class="row">
						<span role="cell" class="mono text-[13px] text-muted-foreground"
							>{data.project.key}-{i.number}</span
						>
						<span role="cell">
							<a href={`${base}/issues/${i.number}`} class="title">{i.title}</a>
						</span>
						<span role="cell"><StatusPill status={i.status} /></span>
						<span role="cell"><PriorityPill priority={i.priority} /></span>
						<span role="cell" class:text-muted-foreground={!i.assigneeName} class="truncate"
							>{i.assigneeName ?? '未割り当て'}</span
						>
						<span
							role="cell"
							class="tabular-nums"
							style:color={isDueAlert(i.dueDate, i.status)
								? 'var(--destructive)'
								: 'var(--muted-foreground)'}>{formatDue(i.dueDate)}</span
						>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</section>

<style>
	.row {
		position: relative;
		min-height: 48px;
	}
	.row:hover {
		background: var(--muted);
	}
	.title {
		font-weight: 500;
	}
	/* 行全体をクリック可能にする */
	.title::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.title:focus-visible {
		outline: none;
	}
	.title:focus-visible::after {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
		border-radius: 4px;
	}
</style>
