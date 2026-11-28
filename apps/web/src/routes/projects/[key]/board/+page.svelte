<script lang="ts">
	import { CircleAlert, X } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { Attachment } from 'svelte/attachments';
	import {
		BOARD_COLUMN_MAX,
		BOARD_COUNT_LIMIT,
		BOARD_PAGE_SIZE,
		type BoardLimits
	} from '#lib/board-limits.ts';
	import IssueTypeTag from '#lib/components/IssueTypeTag.svelte';
	import {
		DONE_STATUS,
		colorFor,
		colorVar,
		formatDue,
		isDueAlert,
		milestoneLabel,
		PRIORITY_CLASS,
		PRIORITY_LABEL,
		type Status
	} from '#lib/labels.ts';
	import IssueSheet from '../IssueSheet.svelte';
	import { getChanges, getIssueDetail } from '../issues/[number=int]/issue.remote';
	import { boardArg } from './board-arg';
	import { getBoard, moveCard } from './board.remote';
	import type { PageProps } from './$types';

	let { data, params }: PageProps = $props();
	/**
	 * 下へスクロールして読み込む数を増やした列。プロジェクトかマイルストーンの絞り込みが変わったら最初（BOARD_PAGE_SIZE）に戻す
	 */
	let loaded = $state<{ scope: string; limits: BoardLimits }>({ scope: '', limits: {} });
	const scope = $derived(`${params.key}\n${page.url.searchParams.get('milestone') ?? ''}`);
	const limits = $derived(loaded.scope === scope ? loaded.limits : {});
	const limitOf = (status: Status) => limits[status] ?? BOARD_PAGE_SIZE;
	const ref = $derived(boardArg(params.key, page.url.searchParams, limits));
	const board = $derived(await getBoard(ref));

	type Columns = typeof board.columns;
	type Card = Columns[Status][number];

	const clone = (c: Columns): Columns =>
		Object.fromEntries(Object.entries(c).map(([s, items]) => [s, [...items]]));

	let columns = $derived(clone(board.columns));
	/** 列の課題の数。上限で出していない分も含め、ドラッグ中の出入りも反映する */
	const total = (status: Status) =>
		board.totals[status] - board.columns[status].length + columns[status].length;
	/**
	 * まだ読み込んでいない課題の数（0 より大きければ続きがある）。
	 * サーバーは BOARD_COUNT_LIMIT を超える列を数え切らないので、counted でないときは正確な数ではない
	 */
	const hidden = (status: Status) => board.totals[status] - board.columns[status].length;
	/** 列の課題の数が正確か（BOARD_COUNT_LIMIT 以下か、すべて読み込んだ） */
	const counted = (status: Status) =>
		board.totals[status] <= BOARD_COUNT_LIMIT || hidden(status) <= 0;
	/** その列のステータス（とマイルストーン）で絞り込んだ課題一覧 */
	const listHref = (status: Status) =>
		`/projects/${data.project.key}?status=${encodeURIComponent(status)}` +
		(ref.milestone ? `&milestone=${encodeURIComponent(ref.milestone)}` : '');
	let snapshot: Columns | null = null;
	let message = $state<string | null>(null);
	let pending = $state(false);
	let opened = $state<number | null>(null);
	/** 続きを読み込んでいる列 */
	let loading = $state<Status | null>(null);
	/** カードをドラッグしている間。列を読み込み直すと、ドラッグ中の列が入れ替わるので続きを読み込まない */
	let dragging = $state(false);

	/** 列の続きを BOARD_PAGE_SIZE 件読み込む（getBoard の引数の、その列の数を増やす） */
	async function loadMore(status: Status) {
		if (loading !== null || pending || dragging || hidden(status) <= 0) return;
		if (limitOf(status) >= BOARD_COLUMN_MAX) return;
		loading = status;
		// 「読み込み中」を先に出す（読み込む数を変えた更新は、取得が終わるまで画面に出ない）
		await tick();
		loaded = {
			scope,
			limits: { ...limits, [status]: Math.min(BOARD_COLUMN_MAX, limitOf(status) + BOARD_PAGE_SIZE) }
		};
	}
	$effect(() => {
		void board;
		loading = null;
	});

	/**
	 * 列の一番下（続きを読み込むボタン）が見えたら続きを読み込む。読み込める状態（ready）になるか読み込む数が変わると
	 * 付け直すので、読み込んだ後・ドラッグを終えた後もまだ見えていれば、もう一度読み込む
	 */
	const loadWhenVisible =
		(status: Status, limit: number, ready: boolean): Attachment<HTMLElement> =>
		(el) => {
			void limit;
			if (!ready) return;
			const observer = new IntersectionObserver((entries) => {
				if (entries.some((e) => e.isIntersecting)) void loadMore(status);
			});
			observer.observe(el);
			return () => observer.disconnect();
		};

	/** 列のカードの欄の高さを、画面の下端までにする（列ごとに縦にスクロールする） */
	const fitToViewport: Attachment<HTMLElement> = (el) => {
		const measure = () =>
			el.style.setProperty('--board-top', `${el.getBoundingClientRect().top + window.scrollY}px`);
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	};

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
		dragging = true;
		snapshot ??= clone(columns);
		columns = { ...columns, [status]: e.detail.items };
	}

	async function finalize(status: Status, e: CustomEvent<DndEvent<Card>>) {
		const items = e.detail.items;
		dragging = false;
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
		// 隣の課題は position の順で送る。完了の列は position の大きい順に出しているので、画面の上が後ろになる
		const above = items[idx - 1]?.id ?? '';
		const below = items[idx + 1]?.id ?? '';
		const [beforeId, afterId] = status === DONE_STATUS ? [below, above] : [above, below];
		// 移した先の列は、落とした課題も含めて今見えている数を読み込む（増やさないと、取り直したときに一番下のカードが消える）
		const nextLimits =
			items.length > limitOf(status)
				? { ...limits, [status]: Math.min(BOARD_COLUMN_MAX, items.length) }
				: limits;
		try {
			// 移動と最新の列の再取得を 1 往復で行う（サーバー側で、移動した後の引数の getBoard を refresh）
			await moveCard({
				...boardArg(params.key, page.url.searchParams, nextLimits),
				issueId: String(e.detail.info.id),
				status,
				beforeId,
				afterId
			});
			// 取り直した結果は受け取り済みなので、引数を切り替えても取得は出ない
			if (nextLimits !== limits) loaded = { scope, limits: nextLimits };
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
						<option value={m.id} selected={ref.milestone === m.id}>
							{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}
						</option>
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

	<div
		class="board"
		class:with-sheet={opened !== null}
		style:--columns={board.statuses.length}
		{@attach fitToViewport}
	>
		{#each board.statuses as { key: status, name, color } (status)}
			<section
				class="column"
				style:--c={colorVar(color)}
				data-testid={`column-${status}`}
				aria-label={name}
			>
				<h2 class="column-head">
					{name}
					<span class="count">{counted(status) ? total(status) : `${BOARD_COUNT_LIMIT}+`}</span>
				</h2>
				<div class="cards">
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
								<div class="head">
									<span class="ident">
										{#if card.typeName}<IssueTypeTag
												name={card.typeName}
												color={card.typeColor}
											/>{/if}
										<span class="key">{data.project.key}-{card.number}</span>
										{#if card.parentNumber !== null}
											<span
												class="parent"
												title={`${data.project.key}-${card.parentNumber} の子課題`}
											>
												<svg width="12" height="12" aria-hidden="true">
													<use href="#bi-parent" />
												</svg>{card.parentNumber}
											</span>
										{/if}
									</span>
									{#if card.priority !== 'none'}<span class="pill {PRIORITY_CLASS[card.priority]}">
											{PRIORITY_LABEL[card.priority]}
										</span>{/if}
								</div>
								<a href={`/projects/${data.project.key}/issues/${card.number}`} class="title">
									{card.title}
								</a>
								{#if card.categoryNames.length > 0 || card.milestoneName}
									<div class="tags">
										{#each card.categoryNames as name, i (i)}<span class="tag">{name}</span>{/each}
										{#if card.milestoneName}<span class="ms">
												<svg width="12" height="12" aria-hidden="true">
													<use href="#bi-flag" />
												</svg><span class="truncate">{card.milestoneName}</span>
											</span>{/if}
									</div>
								{/if}
								<div class="foot">
									<span class="who">
										{#if card.assigneeNames.length === 0}
											<span class="avatar">–</span>
										{:else}
											<span class="avatars">
												{#each card.assigneeNames.slice(0, 3) as name, i (i)}
													<span class="avatar" style:--c={colorFor(name)}>{name[0]}</span>
												{/each}
											</span>
										{/if}
										<span class="truncate">
											{card.assigneeNames.length === 0
												? '未割当'
												: card.assigneeNames.length === 1
													? card.assigneeNames[0]
													: `${card.assigneeNames[0]} 他${card.assigneeNames.length - 1}名`}
										</span>
									</span>
									<span class="due" class:late={isDueAlert(card.dueDate, status)}>
										<svg width="12" height="12" aria-hidden="true">
											<use href="#bi-calendar" />
										</svg>{formatDue(card.dueDate)}
									</span>
								</div>
							</li>
						{/each}
					</ul>
					{#if hidden(status) > 0 && limitOf(status) < BOARD_COLUMN_MAX}
						<button
							type="button"
							class="more"
							disabled={loading !== null}
							onclick={() => loadMore(status)}
							{@attach loadWhenVisible(
								status,
								limitOf(status),
								loading === null && !pending && !dragging
							)}
						>
							{loading === status
								? '読み込み中…'
								: counted(status)
									? `さらに表示（残り ${hidden(status)} 件）`
									: 'さらに表示'}
						</button>
					{:else if hidden(status) > 0}
						<a class="more" href={listHref(status)}>
							{#if status === DONE_STATUS}
								{counted(status)
									? `以前に完了した ${hidden(status)} 件を一覧で見る`
									: '以前に完了した課題を一覧で見る'}
							{:else}
								{counted(status)
									? `ほか ${hidden(status)} 件を一覧で見る`
									: 'ほかの課題を一覧で見る'}
							{/if}
						</a>
					{/if}
				</div>
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

<!--
	カードごとのアイコンは、@lucide/svelte と同じ図形を 1 回だけ symbol に置き、<use> で参照する。lucide のコンポーネントや
	SVG をカードごとに書くと、カードが数百枚あるときにサーバーでの描画と HTML が大きくなるため
-->
<svg class="sprite" aria-hidden="true">
	<symbol
		id="bi-calendar"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path
			d="M3 9h18"
		/>
	</symbol>
	<symbol
		id="bi-parent"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" />
	</symbol>
	<symbol
		id="bi-flag"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path
			d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"
		/>
	</symbol>
</svg>

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
	/* カードの欄は画面の下端まで（列の見出し・余白の分を引く）にして、列ごとに縦にスクロールする。
	   --board-top は .board の上端の位置（fitToViewport）。測る前（サーバーでの描画）は目安の値 */
	.cards {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: max(320px, calc(100dvh - var(--board-top, 220px) - 80px));
		overflow-y: auto;
		overscroll-behavior: contain;
		/* カードの影・フォーカスの枠が切れないよう、スクロールの範囲を少し外へ広げる */
		margin: -4px;
		padding: 4px;
	}
	ul {
		flex: 1 0 auto;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 80px;
		border-radius: var(--radius-sm);
	}
	.more {
		padding: 4px;
		border: 0;
		background: none;
		text-align: center;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.more:hover:not(:disabled) {
		color: var(--foreground);
		text-decoration: underline;
	}
	.more:disabled {
		cursor: default;
	}
	.sprite {
		display: none;
	}
	/*
	 * カードの中は、要素ごとに Tailwind のクラスやコンポーネントのスコープのクラスを付けず、短いクラス 1 つで見た目を付ける。
	 * カードが数百枚あると、クラスの文字列だけで HTML が 100KB 近くになり、サーバーでの描画が延びるため。
	 * 値は元の Tailwind のクラスと同じ（text-xs は Tailwind の変数をそのまま使う。calc(1 / 0.75) と書くと
	 * CSS の圧縮で 1.33333 になり、行の高さが 16px からずれる。gap-1.5 は 0.375rem など）
	 */
	.column :global {
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
		.head,
		.foot {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
		}
		.ident,
		.who {
			display: flex;
			min-width: 0;
			align-items: center;
			gap: 0.375rem;
		}
		.key,
		.parent,
		.tags,
		.foot {
			font-size: var(--text-xs);
			line-height: var(--text-xs--line-height);
			color: var(--muted-foreground);
		}
		.key {
			font-family: var(--font-mono);
		}
		.parent {
			display: flex;
			align-items: center;
			gap: 0.125rem;
		}
		.pill {
			--c: var(--c-orange);
			height: 20px;
			font-size: 11px;
			padding: 0 8px;
		}
		.title {
			font-weight: 500;
			line-height: 1.45;
			text-wrap: pretty;
		}
		.title:hover {
			text-decoration: underline;
		}
		.tags {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.375rem;
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
		.ms {
			display: flex;
			min-width: 0;
			align-items: center;
			gap: 0.25rem;
		}
		.ms svg {
			flex-shrink: 0;
		}
		.avatar {
			--size: 20px;
		}
		.avatars {
			display: flex;
			flex-shrink: 0;
		}
		.avatars .avatar + .avatar {
			margin-left: -6px;
			box-shadow: 0 0 0 2px var(--card);
		}
		.due {
			display: flex;
			flex-shrink: 0;
			align-items: center;
			gap: 0.25rem;
		}
		.due.late {
			color: var(--destructive);
		}
	}
</style>
