<script lang="ts">
	import { Calendar, CircleAlert, CornerDownRight, Flag, X } from '@lucide/svelte';
	import { page } from '$app/state';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import IssueTypeTag from '#lib/components/IssueTypeTag.svelte';
	import PriorityPill from '#lib/components/PriorityPill.svelte';
	import {
		colorFor,
		colorVar,
		formatDue,
		isDueAlert,
		milestoneLabel,
		type Status
	} from '#lib/labels.ts';
	import IssueSheet from '../IssueSheet.svelte';
	import { getChanges, getIssueDetail } from '../issues/[number=int]/issue.remote';
	import { getBoard, moveCard } from './board.remote';
	import type { PageProps } from './$types';

	let { data, params }: PageProps = $props();
	const ref = $derived({
		key: params.key,
		milestone: page.url.searchParams.get('milestone') ?? ''
	});
	const board = $derived(await getBoard(ref));

	type Columns = typeof board.columns;
	type Card = Columns[Status][number];

	const clone = (c: Columns): Columns =>
		Object.fromEntries(Object.entries(c).map(([s, items]) => [s, [...items]]));

	let columns = $derived(clone(board.columns));
	let snapshot: Columns | null = null;
	let message = $state<string | null>(null);
	let pending = $state(false);
	let opened = $state<number | null>(null);

	/** 修飾キー付き・中クリックはブラウザの既定（新しいタブなど）に任せる */
	function openSheet(e: MouseEvent, card: Card) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		opened = card.number;
		// シートに隠れる位置のカードは見える位置までスクロールする（.board の scroll-padding を使う）
		const el = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
	}

	function consider(status: Status, e: CustomEvent<DndEvent<Card>>) {
		message = null;
		snapshot ??= clone(columns);
		columns = { ...columns, [status]: e.detail.items };
	}

	async function finalize(status: Status, e: CustomEvent<DndEvent<Card>>) {
		const items = e.detail.items;
		columns = { ...columns, [status]: items };
		const idx = items.findIndex((i) => i.id === e.detail.info.id);
		if (idx === -1) return; // 移動元の列。移動先の列の finalize で送信する
		const before = snapshot;
		snapshot = null;
		pending = true;

		// 400/409 は業務エラーなのでサーバーのメッセージを出し、それ以外は汎用文言にする
		const failure = (err: unknown) => {
			const { status, body } = (err ?? {}) as { status?: number; body?: { message?: string } };
			return (status === 400 || status === 409) && body?.message
				? body.message
				: 'この課題は移動できません';
		};
		try {
			// 移動と最新の列の再取得を 1 往復で行う（サーバー側で getBoard を refresh）
			await moveCard({
				...ref,
				issueId: String(e.detail.info.id),
				status,
				beforeId: items[idx - 1]?.id ?? '',
				afterId: items[idx + 1]?.id ?? ''
			});
			// シートで開いている課題なら、表示中のステータスも取り直す
			if (items[idx].number === opened) {
				getIssueDetail({ key: ref.key, number: opened })
					.refresh()
					.catch(() => {});
				getChanges({ key: ref.key, number: opened })
					.refresh()
					.catch(() => {});
			}
		} catch (err) {
			if (before) columns = before;
			message = failure(err);
			// 失敗時は他の人の変更も反映されているかもしれないので取り直す
			getBoard(ref)
				.refresh()
				.catch(() => {});
		} finally {
			pending = false;
		}
	}
</script>

<section class="grid gap-4">
	{#if board.milestones.length > 0}
		<form
			method="GET"
			class="flex flex-wrap items-end gap-3"
			onchange={(e) => e.currentTarget.requestSubmit()}
		>
			<div class="field w-56 gap-1.5">
				<label class="label text-[0.8125rem]" for="board-milestone">マイルストーン</label>
				<select class="select" id="board-milestone" name="milestone">
					<option value="">すべて</option>
					<option value="none" selected={ref.milestone === 'none'}>未設定</option>
					{#each board.milestones as m (m.id)}
						<option value={m.id} selected={ref.milestone === m.id}
							>{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}</option
						>
					{/each}
				</select>
			</div>
			<noscript><button type="submit" class="btn btn-outline">絞り込む</button></noscript>
		</form>
	{/if}

	{#if message}
		<div role="alert" class="alert alert-destructive" style="grid-template-columns: 16px 1fr auto">
			<CircleAlert />
			<div>
				<div class="alert-title">ステータスを変更できませんでした</div>
				<div style="opacity: 0.9">{message}</div>
			</div>
			<button type="button" class="icon-btn" aria-label="閉じる" onclick={() => (message = null)}>
				<X />
			</button>
		</div>
	{/if}

	<div class="board" class:with-sheet={opened !== null} style:--columns={board.statuses.length}>
		{#each board.statuses as { key: status, name, color } (status)}
			<section
				class="column"
				style:--c={colorVar(color)}
				data-testid={`column-${status}`}
				aria-label={name}
			>
				<h2 class="column-head">
					{name}
					<span class="count">{columns[status].length}</span>
				</h2>
				<ul
					use:dndzone={{
						items: columns[status],
						flipDurationMs: 150,
						type: 'issue',
						dragDisabled: !!data.project.archivedAt || !data.canChangeStatus || pending,
						dropTargetStyle: { outline: '2px dashed var(--ring)', outlineOffset: '2px' }
					}}
					onconsider={(e) => consider(status, e)}
					onfinalize={(e) => finalize(status, e)}
				>
					{#each columns[status] as card (card.id)}
						<!-- キーボードではタイトルのリンクから開ける -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
						<li
							class="card-item"
							class:selected={opened === card.number}
							data-testid={`card-${card.number}`}
							onclick={(e) => openSheet(e, card)}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="flex min-w-0 items-center gap-1.5">
									{#if card.typeName}<IssueTypeTag
											name={card.typeName}
											color={card.typeColor}
										/>{/if}
									<span class="mono text-xs text-muted-foreground"
										>{data.project.key}-{card.number}</span
									>
									{#if card.parentNumber !== null}
										<span
											class="flex items-center gap-0.5 text-xs text-muted-foreground"
											title={`${data.project.key}-${card.parentNumber} の子課題`}
											><CornerDownRight size={12} />{card.parentNumber}</span
										>
									{/if}
								</span>
								{#if card.priority !== 'none'}<PriorityPill priority={card.priority} small />{/if}
							</div>
							<a href={`/projects/${data.project.key}/issues/${card.number}`} class="title"
								>{card.title}</a
							>
							{#if card.categories.length > 0 || card.milestoneName}
								<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
									{#each card.categories as c (c.id)}<span class="tag">{c.name}</span>{/each}
									{#if card.milestoneName}<span class="flex min-w-0 items-center gap-1"
											><Flag size={12} class="shrink-0" /><span class="truncate"
												>{card.milestoneName}</span
											></span
										>{/if}
								</div>
							{/if}
							<div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
								<span class="flex min-w-0 items-center gap-1.5">
									{#if card.assignees.length === 0}
										<span class="avatar" style="--size: 20px">–</span>
									{:else}
										<span class="avatars">
											{#each card.assignees.slice(0, 3) as u (u.id)}
												<span class="avatar" style="--size: 20px" style:--c={colorFor(u.name)}
													>{u.name[0]}</span
												>
											{/each}
										</span>
									{/if}
									<span class="truncate"
										>{card.assignees.length === 0
											? '未割当'
											: card.assignees.length === 1
												? card.assignees[0].name
												: `${card.assignees[0].name} 他${card.assignees.length - 1}名`}</span
									>
								</span>
								<span
									class="flex shrink-0 items-center gap-1"
									style:color={isDueAlert(card.dueDate, status) ? 'var(--destructive)' : undefined}
								>
									<Calendar size={12} />{formatDue(card.dueDate)}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>

	{#if opened !== null}
		<IssueSheet
			projectKey={data.project.key}
			number={opened}
			onclose={() => (opened = null)}
			onsaved={() =>
				getBoard(ref)
					.refresh()
					.catch(() => {})}
		/>
	{/if}
</section>

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(264px, 1fr));
		gap: 12px;
		overflow-x: auto;
		padding-bottom: 8px;
	}
	/* シート（IssueSheet と同じ幅）に隠れる右端の列もスクロールして見えるようにする */
	.board.with-sheet {
		padding-right: min(680px, 100vw);
		scroll-padding-right: min(680px, 100vw);
	}
	.column {
		background: var(--col);
		border: 1px solid var(--border);
		border-top: 3px solid var(--c);
		border-radius: var(--radius-md);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 480px;
	}
	.column-head {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px;
		height: 1.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.count {
		display: inline-flex;
		align-items: center;
		height: 1.25rem;
		padding: 0 8px;
		border-radius: var(--radius-pill);
		background: color-mix(in oklch, var(--c) 16%, transparent);
		color: color-mix(in oklch, var(--c) 75%, var(--foreground));
		font-size: 0.75rem;
	}
	ul {
		flex: 1;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 80px;
		border-radius: var(--radius-sm);
	}
	.card-item {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		padding: 12px;
		display: grid;
		gap: 10px;
		box-shadow: var(--card-shadow);
		cursor: grab;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.card-item:hover {
		border-color: var(--primary);
		box-shadow: var(--card-shadow-hover);
	}
	.card-item.selected {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 8%, var(--card));
		box-shadow:
			inset 3px 0 0 var(--primary),
			var(--card-shadow);
	}
	.title {
		font-weight: 500;
		line-height: 1.45;
		text-wrap: pretty;
	}
	.title:hover {
		text-decoration: underline;
	}
	.tag {
		max-width: 12em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.avatars {
		display: flex;
		flex-shrink: 0;
	}
	.avatars .avatar + .avatar {
		margin-left: -6px;
		box-shadow: 0 0 0 2px var(--card);
	}
</style>
