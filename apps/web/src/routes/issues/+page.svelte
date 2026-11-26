<script lang="ts">
	import { CornerDownRight, Inbox } from '@lucide/svelte';
	import { page } from '$app/state';
	import IssueTypeTag from '#lib/components/IssueTypeTag.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import PriorityPill from '#lib/components/PriorityPill.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	import { formatDate, formatDateTime, formatDue, isDueAlert } from '#lib/labels.ts';
	import { ISSUE_PAGE_SIZE, lastPage, withPage } from '#lib/pagination.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const last = $derived(lastPage(data.total, ISSUE_PAGE_SIZE));
	const pageHref = (p: number) => `/issues${withPage(page.url.searchParams, p)}`;
	const firstShown = $derived((data.page - 1) * ISSUE_PAGE_SIZE + 1);
	const count = (n: number) => n.toLocaleString('ja-JP');
	// キー列の幅は課題一覧と同じ考え方。プロジェクトごとにキーの長さが違うので、いちばん長いものに合わせる
	const keyColumnWidth = $derived.by(() => {
		const chars = data.issues.reduce(
			(max, i) => Math.max(max, `${i.projectKey}-${i.number}`.length),
			0
		);
		return `max(96px, calc(${chars} * 0.6 * 0.8125rem + 18px))`;
	});
</script>

<section class="grid gap-4">
	<div class="grid gap-1">
		<h1 class="page-title">自分の課題</h1>
		<p class="page-desc">参加しているプロジェクトの課題を、期限の近い順に表示します</p>
	</div>

	<form
		method="GET"
		class="flex flex-wrap items-end gap-3"
		onchange={(e) => e.currentTarget.requestSubmit()}
	>
		<div class="field w-40 gap-1.5">
			<label class="label text-[0.8125rem]" for="my-role">対象</label>
			<select class="select" id="my-role" name="role">
				<option value="">担当している課題</option>
				<option value="reporter" selected={data.filters.role === 'reporter'}>登録した課題</option>
			</select>
		</div>
		<div class="field w-40 gap-1.5">
			<label class="label text-[0.8125rem]" for="my-status">ステータス</label>
			<select class="select" id="my-status" name="status">
				<option value="">完了以外</option>
				<option value="done" selected={data.filters.status === 'done'}>完了</option>
				<option value="all" selected={data.filters.status === 'all'}>すべて</option>
			</select>
		</div>
		<noscript><button type="submit" class="btn btn-outline">絞り込む</button></noscript>
		<span class="ml-auto pb-2 text-[0.8125rem] text-muted-foreground tabular-nums">
			{#if last > 1}
				{count(data.total)} 件中 {count(firstShown)}〜{count(firstShown + data.issues.length - 1)} 件
			{:else}
				{count(data.total)} 件
			{/if}
		</span>
	</form>

	{#if data.issues.length === 0}
		<div class="empty">
			<span class="empty-icon"><Inbox /></span>
			<div class="grid gap-1">
				<div class="empty-title">該当する課題はありません</div>
				<div class="text-muted-foreground">
					{data.filters.role === 'reporter'
						? '自分が登録した課題がここに表示されます'
						: '自分が担当者になっている課題がここに表示されます'}
				</div>
			</div>
		</div>
	{:else}
		<div
			class="grid-table"
			style:--key-col={keyColumnWidth}
			style="--cols: var(--key-col) minmax(240px, 1fr) 160px 120px 80px 128px 76px var(--stamp-col)"
		>
			<div
				role="table"
				aria-label="自分の課題"
				style="min-width: calc(var(--key-col) + 820px + var(--stamp-col))"
			>
				<div role="row" class="grid-table-head">
					<span role="columnheader">キー</span>
					<span role="columnheader">タイトル</span>
					<span role="columnheader">プロジェクト</span>
					<span role="columnheader">ステータス</span>
					<span role="columnheader">優先度</span>
					<span role="columnheader">担当者</span>
					<span role="columnheader">期限</span>
					<span role="columnheader">更新日</span>
				</div>
				{#each data.issues as i (i.id)}
					{@const base = `/projects/${i.projectKey}`}
					<div role="row" class="row">
						<span role="cell" class="mono text-[0.8125rem] whitespace-nowrap text-muted-foreground">
							{i.projectKey}-{i.number}
						</span>
						<span role="cell" class="flex min-w-0 items-center gap-2">
							{#if i.parentNumber !== null}
								<span
									class="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground"
									title={`${i.projectKey}-${i.parentNumber} の子課題`}
								>
									<CornerDownRight size={14} />{i.parentNumber}
								</span>
							{/if}
							{#if i.typeName}<IssueTypeTag name={i.typeName} color={i.typeColor} />{/if}
							<a href={`${base}/issues/${i.number}`} class="title truncate">{i.title}</a>
						</span>
						<span role="cell" class="truncate text-muted-foreground" title={i.projectName}>
							{i.projectName}
						</span>
						<span role="cell">
							<StatusPill
								status={i.status}
								statuses={i.statusName
									? [{ key: i.status, name: i.statusName, color: i.statusColor ?? 'gray' }]
									: []}
							/>
						</span>
						<span role="cell"><PriorityPill priority={i.priority} /></span>
						<span
							role="cell"
							class:text-muted-foreground={i.assignees.length === 0}
							class="truncate"
							title={i.assignees.map((u) => u.name).join('、') || undefined}
						>
							{i.assignees.map((u) => u.name).join('、') || '未割当'}
						</span>
						<span
							role="cell"
							class="tabular-nums"
							style:color={isDueAlert(i.dueDate, i.status)
								? 'var(--destructive)'
								: 'var(--muted-foreground)'}
						>
							{formatDue(i.dueDate)}
						</span>
						<span
							role="cell"
							class="text-muted-foreground tabular-nums"
							title={formatDateTime(i.updatedAt)}
						>
							{formatDate(i.updatedAt)}
						</span>
					</div>
				{/each}
			</div>
		</div>
		<Pager current={data.page} {last} href={pageHref} />
	{/if}
</section>

<style>
	/* 更新日（2026/11/22）の列。文字サイズの設定に合わせて広げる */
	.grid-table {
		--stamp-col: 6rem;
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
