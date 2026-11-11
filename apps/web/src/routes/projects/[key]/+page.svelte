<script lang="ts">
	import { CornerDownRight, Flag, Inbox, Search, SearchX, Trash2 } from '@lucide/svelte';
	import IssueTypeTag from '#lib/components/IssueTypeTag.svelte';
	import PriorityPill from '#lib/components/PriorityPill.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	import {
		PRIORITIES,
		PRIORITY_LABEL,
		formatDateTime,
		formatDue,
		isDueAlert,
		milestoneLabel
	} from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	const filtering = $derived(Object.values(data.filters).some(Boolean));
</script>

<section class="grid gap-4">
	<form
		method="GET"
		class="flex flex-wrap items-end gap-3"
		onchange={(e) => e.currentTarget.requestSubmit()}
	>
		<div class="field w-56 gap-1.5">
			<label class="label text-[0.8125rem]" for="filter-q">キーワード</label>
			<div class="search">
				<Search size={16} class="search-icon" />
				<input
					class="input"
					id="filter-q"
					name="q"
					type="search"
					maxlength={200}
					placeholder="タイトル・課題キー"
					value={data.filters.q ?? ''}
				/>
			</div>
		</div>
		<div class="field w-40 gap-1.5">
			<label class="label text-[0.8125rem]" for="filter-status">ステータス</label>
			<select class="select" id="filter-status" name="status">
				<option value="">すべて</option>
				{#each data.statuses as s (s.key)}
					<option value={s.key} selected={data.filters.status === s.key}>{s.name}</option>
				{/each}
			</select>
		</div>
		{#if data.issueTypes.length > 0}
			<div class="field w-36 gap-1.5">
				<label class="label text-[0.8125rem]" for="filter-type">種別</label>
				<select class="select" id="filter-type" name="type">
					<option value="">すべて</option>
					<option value="none" selected={data.filters.typeId === 'none'}>未設定</option>
					{#each data.issueTypes as t (t.id)}
						<option value={t.id} selected={data.filters.typeId === t.id}>{t.name}</option>
					{/each}
				</select>
			</div>
		{/if}
		<div class="field w-36 gap-1.5">
			<label class="label text-[0.8125rem]" for="filter-priority">優先度</label>
			<select class="select" id="filter-priority" name="priority">
				<option value="">すべて</option>
				{#each PRIORITIES as p (p)}
					<option value={p} selected={data.filters.priority === p}>{PRIORITY_LABEL[p]}</option>
				{/each}
			</select>
		</div>
		<div class="field w-40 gap-1.5">
			<label class="label text-[0.8125rem]" for="filter-assignee">担当者</label>
			<select class="select" id="filter-assignee" name="assignee">
				<option value="">すべて</option>
				<option value="none" selected={data.filters.assigneeId === 'none'}>未割当</option>
				{#each data.assignees as u (u.id)}
					<option value={u.id} selected={data.filters.assigneeId === u.id}>{u.name}</option>
				{/each}
			</select>
		</div>
		{#if data.categories.length > 0}
			<div class="field w-40 gap-1.5">
				<label class="label text-[0.8125rem]" for="filter-category">カテゴリー</label>
				<select class="select" id="filter-category" name="category">
					<option value="">すべて</option>
					<option value="none" selected={data.filters.categoryId === 'none'}>未設定</option>
					{#each data.categories as c (c.id)}
						<option value={c.id} selected={data.filters.categoryId === c.id}>{c.name}</option>
					{/each}
				</select>
			</div>
		{/if}
		{#if data.milestones.length > 0}
			<div class="field w-48 gap-1.5">
				<label class="label text-[0.8125rem]" for="filter-milestone">マイルストーン</label>
				<select class="select" id="filter-milestone" name="milestone">
					<option value="">すべて</option>
					<option value="none" selected={data.filters.milestoneId === 'none'}>未設定</option>
					{#each data.milestones as m (m.id)}
						<option value={m.id} selected={data.filters.milestoneId === m.id}
							>{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}</option
						>
					{/each}
				</select>
			</div>
		{/if}
		<noscript><button type="submit" class="btn btn-outline">絞り込む</button></noscript>
		<span class="ml-auto pb-2 text-[0.8125rem] text-muted-foreground">{data.issues.length} 件</span>
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
		<div class="grid-table" style="--cols: 96px minmax(240px, 1fr) 120px 80px 140px 140px 88px">
			<div role="table" aria-label="課題一覧" style="min-width: 900px">
				<div role="row" class="grid-table-head">
					<span role="columnheader">キー</span>
					<span role="columnheader">タイトル</span>
					<span role="columnheader">ステータス</span>
					<span role="columnheader">優先度</span>
					<span role="columnheader">担当者</span>
					<span role="columnheader">マイルストーン</span>
					<span role="columnheader">期限</span>
				</div>
				{#each data.issues as i (i.id)}
					<div role="row" class="row">
						<span role="cell" class="mono text-[0.8125rem] text-muted-foreground"
							>{data.project.key}-{i.number}</span
						>
						<span role="cell" class="flex min-w-0 items-center gap-2">
							{#if i.parentNumber !== null}
								<span
									class="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground"
									title={`${data.project.key}-${i.parentNumber} の子課題`}
									><CornerDownRight size={14} />{i.parentNumber}</span
								>
							{/if}
							{#if i.typeName}<IssueTypeTag name={i.typeName} color={i.typeColor} />{/if}
							<a href={`${base}/issues/${i.number}`} class="title truncate">{i.title}</a>
							{#if i.categories.length > 0}
								<span class="tags">
									{#each i.categories as c (c.id)}<span class="tag">{c.name}</span>{/each}
								</span>
							{/if}
						</span>
						<span role="cell"><StatusPill status={i.status} /></span>
						<span role="cell"><PriorityPill priority={i.priority} /></span>
						<span
							role="cell"
							class:text-muted-foreground={i.assignees.length === 0}
							class="truncate"
							title={i.assignees.map((u) => u.name).join('、') || undefined}
							>{i.assignees.map((u) => u.name).join('、') || '未割当'}</span
						>
						<span role="cell" class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
							{#if i.milestoneName}<Flag size={14} class="shrink-0" /><span class="truncate"
									>{i.milestoneName}</span
								>{:else}—{/if}
						</span>
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

	{#if data.deletedIssues.length > 0}
		<details class="deleted">
			<summary class="text-[0.8125rem] text-muted-foreground">
				<Trash2 size={14} />削除した課題 {data.deletedIssues.length} 件
			</summary>
			<ul>
				{#each data.deletedIssues as d (d.number)}
					<li>
						<span class="mono text-[0.8125rem] text-muted-foreground"
							>{data.project.key}-{d.number}</span
						>
						<a href={`${base}/issues/${d.number}`} class="min-w-0 truncate">{d.title}</a>
						<span class="ml-auto shrink-0 text-xs text-muted-foreground"
							>{d.deletedByName ?? '—'} が {d.deletedAt ? formatDateTime(d.deletedAt) : ''} に削除</span
						>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.deleted summary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}
	.deleted ul {
		display: grid;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--border);
	}
	.deleted li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 40px;
		border-bottom: 1px solid var(--border);
	}
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
	/* 行は 1 行のまま。カテゴリーは列の半分までに収め、足りなければ各タグを省略表示にする */
	.tags {
		display: flex;
		flex: 0 0 auto;
		gap: 4px;
		max-width: 50%;
		overflow: hidden;
	}
	.tag {
		min-width: 2.5em;
		max-width: 10em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.search {
		position: relative;
	}
	.search :global(.search-icon) {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted-foreground);
		pointer-events: none;
	}
	.search .input {
		padding-left: 32px;
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
		border-radius: var(--radius-sm);
	}
</style>
