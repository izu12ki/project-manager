<script lang="ts">
	import {
		ArrowDown,
		ArrowUp,
		ArrowUpDown,
		CornerDownRight,
		Flag,
		Inbox,
		Search,
		SearchX,
		Trash2
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import IssueTypeTag from '#lib/components/IssueTypeTag.svelte';
	import MeFilterButton from '#lib/components/MeFilterButton.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import PriorityPill from '#lib/components/PriorityPill.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	import {
		isDefaultIssueSort,
		nextIssueSort,
		withIssueSort,
		type IssueSortKey
	} from '#lib/issue-sort.ts';
	import {
		PRIORITIES,
		PRIORITY_LABEL,
		formatDate,
		formatDateTime,
		formatDue,
		isDueAlert,
		milestoneLabel
	} from '#lib/labels.ts';
	import { ISSUE_PAGE_SIZE, lastPage, withPage } from '#lib/pagination.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/projects/${data.project.key}`);
	// 既定（完了以外）と違う絞り込みがあるか。ステータスの undefined は「すべて」
	const filtering = $derived(
		Object.entries(data.filters).some(([k, v]) => (k === 'status' ? v !== 'open' : Boolean(v)))
	);
	const selectedStatus = $derived(data.filters.status ?? 'all');
	// 「自分」のボタンは、自分が担当者の候補にいるときだけ出す
	const me = $derived(
		data.assignees.some((u) => u.id === data.user?.id) ? data.user?.id : undefined
	);
	/** 担当者を自分にして（もう一度押すと外して）絞り込み直す */
	function toggleMe(button: HTMLButtonElement) {
		const form = button.form;
		const select = form?.elements.namedItem('assignee');
		if (!form || !(select instanceof HTMLSelectElement) || !me) return;
		select.value = select.value === me ? '' : me;
		form.requestSubmit();
	}
	const statusOptions = $derived<[string, string][]>([
		['all', 'すべて'],
		...data.statuses.map((s): [string, string] => [s.key, s.name]),
		['open', '完了以外']
	]);
	// 「日付なし」の絞り込みだけを外す（タイムラインから来たとき）
	const withDatesHref = $derived(
		base +
			withPage(new URLSearchParams([...page.url.searchParams].filter(([k]) => k !== 'dates')), 1)
	);
	// 並べ替えても絞り込みは残し、絞り込みを変えても並びは残す
	const sortHref = (key: IssueSortKey) =>
		base + withIssueSort(page.url.searchParams, nextIssueSort(data.sort, key));
	const clearFiltersHref = $derived(base + withIssueSort(new URLSearchParams(), data.sort));
	const last = $derived(lastPage(data.total, ISSUE_PAGE_SIZE));
	const pageHref = (p: number) => base + withPage(page.url.searchParams, p);
	const firstShown = $derived((data.page - 1) * ISSUE_PAGE_SIZE + 1);
	const count = (n: number) => n.toLocaleString('ja-JP');
	// キーは 0.8125rem の等幅フォント（JetBrains Mono は 1 文字 0.6em）で出す。
	// プロジェクトのキーは 25 文字まであるので、いちばん長い課題キーが 1 行に収まる幅をキー列に取る。
	// 16px はセルの左右の余白、2px は丸めの誤差の分
	const keyColumnWidth = $derived.by(() => {
		const maxNumber = data.issues.reduce((max, i) => Math.max(max, i.number), 0);
		const chars = `${data.project.key}-${maxNumber}`.length;
		return `max(96px, calc(${chars} * 0.6 * 0.8125rem + 18px))`;
	});
</script>

{#snippet sortHeader(key: IssueSortKey, label: string)}
	{@const active = data.sort.key === key}
	<span
		role="columnheader"
		aria-sort={active ? (data.sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
	>
		<a
			href={sortHref(key)}
			class="sort"
			class:active
			data-sveltekit-noscroll
			data-sveltekit-keepfocus
			title={`${label}で並べ替え`}
		>
			{label}
			{#if !active}
				<ArrowUpDown size={12} class="sort-icon" aria-hidden="true" />
			{:else if data.sort.order === 'asc'}
				<ArrowUp size={12} class="sort-icon" aria-hidden="true" />
			{:else}
				<ArrowDown size={12} class="sort-icon" aria-hidden="true" />
			{/if}
		</a>
	</span>
{/snippet}

<section class="grid gap-4">
	<form method="GET" class="grid gap-3" onchange={(e) => e.currentTarget.requestSubmit()}>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<div class="status-chips" role="radiogroup" aria-labelledby="filter-status">
				<span class="label text-[0.8125rem]" id="filter-status">ステータス</span>
				{#each statusOptions as [value, label] (value)}
					<label class="status-chip">
						<input type="radio" name="status" {value} checked={selectedStatus === value} />
						{label}
					</label>
				{/each}
			</div>
			<span class="ml-auto text-[0.8125rem] text-muted-foreground tabular-nums">
				{#if last > 1}
					{count(data.total)} 件中 {count(firstShown)}〜{count(firstShown + data.issues.length - 1)} 件
				{:else}
					{count(data.total)} 件
				{/if}
			</span>
		</div>
		<div class="flex flex-wrap items-end gap-3">
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
			{#if data.categories.length > 0}
				<div class="field w-36 gap-1.5">
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
				<div class="field w-44 gap-1.5">
					<label class="label text-[0.8125rem]" for="filter-milestone">マイルストーン</label>
					<select class="select" id="filter-milestone" name="milestone">
						<option value="">すべて</option>
						<option value="none" selected={data.filters.milestoneId === 'none'}>未設定</option>
						{#each data.milestones as m (m.id)}
							<option value={m.id} selected={data.filters.milestoneId === m.id}>
								{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}
							</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="field gap-1.5">
				<label class="label text-[0.8125rem]" for="filter-assignee">担当者</label>
				<div class="flex items-center gap-1.5">
					<select class="select w-36" id="filter-assignee" name="assignee">
						<option value="">すべて</option>
						<option value="none" selected={data.filters.assigneeId === 'none'}>未割当</option>
						{#each data.assignees as u (u.id)}
							<option value={u.id} selected={data.filters.assigneeId === u.id}>{u.name}</option>
						{/each}
					</select>
					{#if me}
						<MeFilterButton
							pressed={data.filters.assigneeId === me}
							onclick={(e) => toggleMe(e.currentTarget)}
						/>
					{/if}
				</div>
			</div>
			<div class="field w-28 gap-1.5">
				<label class="label text-[0.8125rem]" for="filter-priority">優先度</label>
				<select class="select" id="filter-priority" name="priority">
					<option value="">すべて</option>
					{#each PRIORITIES as p (p)}
						<option value={p} selected={data.filters.priority === p}>{PRIORITY_LABEL[p]}</option>
					{/each}
				</select>
			</div>
			<div class="field min-w-40 flex-1 basis-40 gap-1.5 sm:max-w-80">
				<label class="label text-[0.8125rem]" for="filter-q">キーワード</label>
				<div class="search">
					<Search size={16} class="search-icon" />
					<input
						class="input"
						id="filter-q"
						name="q"
						type="search"
						maxlength={200}
						placeholder="キーワードを入力"
						title="タイトル・本文・コメント・課題キーから探します"
						value={data.filters.q ?? ''}
					/>
				</div>
			</div>
		</div>
		{#if data.filters.unscheduled}
			<input type="hidden" name="dates" value="none" />
		{/if}
		{#if !isDefaultIssueSort(data.sort)}
			<input type="hidden" name="sort" value={data.sort.key} />
			<input type="hidden" name="order" value={data.sort.order} />
		{/if}
		<noscript><button type="submit" class="btn btn-outline w-fit">絞り込む</button></noscript>
	</form>

	{#if data.filters.unscheduled}
		<p class="hint">
			開始日と期限日が未設定の課題（タイムラインに表示されない課題）だけを表示しています。
			<a href={withDatesHref} class="link">日付の絞り込みを解除</a>
		</p>
	{/if}

	{#if data.issues.length === 0}
		<div class="empty">
			<span class="empty-icon">
				{#if filtering}<SearchX />{:else}<Inbox />{/if}
			</span>
			<div class="grid gap-1">
				<div class="empty-title">
					{filtering ? '条件に一致する課題はありません' : '完了以外の課題はありません'}
				</div>
				<div class="text-muted-foreground">
					{filtering
						? '絞り込み条件を変更してください'
						: data.project.archivedAt
							? 'このプロジェクトはアーカイブ済みです'
							: '完了した課題は「すべて」で表示できます。新しい課題は右上の「新規課題」から起票できます'}
				</div>
			</div>
			{#if filtering}<a href={clearFiltersHref} class="btn btn-outline">絞り込みを解除</a>{/if}
		</div>
	{:else}
		<div
			class="grid-table"
			style:--key-col={keyColumnWidth}
			style="--cols: var(--key-col) minmax(240px, 1fr) 120px 80px 128px 128px 76px 76px var(--stamp-col) var(--stamp-col)"
		>
			<!-- 列の幅の合計と行の左右の余白（16px）。キー列が 96px より広がった分だけ、表の最小幅も広げる。
			     サイドバーを開いた 1440px 幅の画面で、横にスクロールせずに収まる -->
			<div
				role="table"
				aria-label="課題一覧"
				style="min-width: calc(var(--key-col) + 864px + 2 * var(--stamp-col))"
			>
				<div role="row" class="grid-table-head">
					{@render sortHeader('number', 'キー')}
					<span role="columnheader">タイトル</span>
					<span role="columnheader">ステータス</span>
					<span role="columnheader">優先度</span>
					<span role="columnheader">担当者</span>
					<span role="columnheader">マイルストーン</span>
					{@render sortHeader('start', '開始日')}
					{@render sortHeader('due', '期限')}
					{@render sortHeader('created', '登録日')}
					{@render sortHeader('updated', '更新日')}
				</div>
				<!-- セルの見た目は layout.css の .issue-row の規則で付ける（HTML を小さくするため） -->
				{#each data.issues as i (i.number)}
					{@const assignees = i.assigneeNames.join('、')}
					<div role="row" class="issue-row">
						<span role="cell" class="key">{data.project.key}-{i.number}</span>
						<span role="cell" class="main">
							{#if i.parentNumber !== null}
								<span class="parent" title={`${data.project.key}-${i.parentNumber} の子課題`}>
									<CornerDownRight size={14} />{i.parentNumber}
								</span>
							{/if}
							{#if i.typeName}<IssueTypeTag name={i.typeName} color={i.typeColor} />{/if}
							<a href={`${base}/issues/${i.number}`} class="title">{i.title}</a>
							{#if i.categoryNames.length > 0}
								<span class="tags">
									{#each i.categoryNames as c, n (n)}<span class="tag">{c}</span>{/each}
								</span>
							{/if}
						</span>
						<span role="cell"><StatusPill status={i.status} /></span>
						<span role="cell"><PriorityPill priority={i.priority} /></span>
						<span role="cell" class={[assignees && 'who']} title={assignees || undefined}>
							{assignees || '未割当'}
						</span>
						<span role="cell" class="milestone">
							{#if i.milestoneName}<Flag size={14} class="shrink-0" /><span class="truncate">
									{i.milestoneName}
								</span>{:else}—{/if}
						</span>
						<span role="cell" class="date">{formatDue(i.startDate)}</span>
						<span role="cell" class={['date', isDueAlert(i.dueDate, i.status) && 'overdue']}>
							{formatDue(i.dueDate)}
						</span>
						<span role="cell" class="date" title={formatDateTime(i.createdAt)}>
							{formatDate(i.createdAt)}
						</span>
						<span role="cell" class="date" title={formatDateTime(i.updatedAt)}>
							{formatDate(i.updatedAt)}
						</span>
					</div>
				{/each}
			</div>
		</div>
		<Pager current={data.page} {last} href={pageHref} />
	{/if}

	{#if data.deletedIssues.length > 0}
		<details class="deleted">
			<summary class="text-[0.8125rem] text-muted-foreground">
				<Trash2 size={14} />削除した課題 {data.deletedIssues.length} 件
			</summary>
			<ul>
				{#each data.deletedIssues as d (d.number)}
					<li>
						<span class="mono shrink-0 text-[0.8125rem] whitespace-nowrap text-muted-foreground">
							{data.project.key}-{d.number}
						</span>
						<a href={`${base}/issues/${d.number}`} class="min-w-0 truncate">{d.title}</a>
						<span class="ml-auto shrink-0 text-xs text-muted-foreground">
							{d.deletedByName ?? '—'} が {d.deletedAt ? formatDateTime(d.deletedAt) : ''} に削除
						</span>
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
	/* 登録日・更新日（2026/11/22）の列。文字サイズの設定に合わせて広げる */
	.grid-table {
		--stamp-col: 6rem;
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		border-radius: var(--radius-sm);
	}
	.sort:hover,
	.sort.active {
		color: var(--foreground);
	}
	.sort :global(.sort-icon) {
		flex-shrink: 0;
	}
	.sort:not(.active) :global(.sort-icon) {
		opacity: 0.45;
	}
	.sort:hover :global(.sort-icon) {
		opacity: 1;
	}
	.status-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.status-chips .label {
		margin-right: 8px;
	}
	.status-chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 1.75rem;
		padding: 0 12px;
		border-radius: var(--radius-pill);
		font-size: 0.8125rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.status-chip:hover {
		background: var(--accent);
	}
	.status-chip:has(input:checked) {
		background: var(--primary);
		color: var(--primary-foreground);
		font-weight: 600;
	}
	.status-chip:has(input:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* 丸いボタンだけを見せる。ラジオは矢印キーで選べるよう、消さずに見えなくする */
	.status-chip input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		pointer-events: none;
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
</style>
