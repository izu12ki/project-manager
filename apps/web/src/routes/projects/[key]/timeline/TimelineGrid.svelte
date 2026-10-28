<script lang="ts" generics="T extends TimelineIssue & { title: string; canEdit: boolean }">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { page } from '$app/state';
	import { DONE_STATUS, statusColor, statusName } from '$lib/labels';
	import {
		addDays,
		applyDrag,
		barSpan,
		dayCells,
		defaultFrom,
		CLICK_SLOP,
		diffDays,
		dragDelta,
		shortDate,
		weekday,
		type Dated,
		type DragMode,
		type IssueGroup,
		type TimelineIssue,
		type ViewRange
	} from '$lib/timeline';

	interface Props {
		projectKey: string;
		groups: IssueGroup<T>[];
		unscheduled: T[];
		range: ViewRange;
		today: string;
		onjump: (from: string) => void;
		onsave?: (item: T, next: Dated) => void;
		/** 課題名・バー・未スケジュールのチップのクリックで詳細をシート表示する。未指定なら詳細ページへ遷移する */
		onopen?: (item: T) => void;
		/** シートで開いている課題の番号（行を強調する） */
		selected?: number | null;
	}
	let {
		projectKey,
		groups,
		unscheduled,
		range,
		today,
		onjump,
		onsave,
		onopen,
		selected = null
	}: Props = $props();

	/** 課題名の列幅。ドラッグで変えられ、ブラウザに記憶する */
	const LABEL_W_DEFAULT = 240;
	const LABEL_W_MIN = 160;
	const LABEL_W_MAX = 640;
	const LABEL_W_KEY = 'timeline-label-width';
	const clampLabel = (w: number) => Math.round(Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, w)));
	let labelW = $state(LABEL_W_DEFAULT);
	$effect(() => {
		try {
			const saved = Number(localStorage.getItem(LABEL_W_KEY));
			if (saved) labelW = clampLabel(saved);
		} catch {
			// ストレージが使えなければ既定幅のまま
		}
	});
	function saveLabelW() {
		try {
			localStorage.setItem(LABEL_W_KEY, String(labelW));
		} catch {
			// 記憶できなくても今回の表示には影響しない
		}
	}
	let resize = $state<{ startX: number; startW: number } | null>(null);
	function beginResize(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		resize = { startX: e.clientX, startW: labelW };
	}
	function resizeKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 40 : 10;
		if (e.key === 'ArrowLeft') labelW = clampLabel(labelW - step);
		else if (e.key === 'ArrowRight') labelW = clampLabel(labelW + step);
		else return;
		e.preventDefault();
		saveLabelW();
	}

	/** カレンダーの横スクロールは画面下部に固定したバーで操作する（本体のスクロールと同期） */
	let scroller = $state<HTMLDivElement>();
	let hbar = $state<HTMLDivElement>();
	function syncScroll(from: HTMLDivElement | undefined, to: HTMLDivElement | undefined) {
		if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
	}
	/** 伸縮ハンドル（左右 8px）の間に掴める中央が残る最小のバー幅 */
	const MIN_GRIP_W = 24;
	const WEEKDAYS = '日月火水木金土';
	const cells = $derived(dayCells(range));
	const width = $derived(range.days * range.dayWidth);
	const wide = $derived(range.dayWidth >= 24);
	const months = $derived(
		cells
			.filter((c) => c.monthStart)
			.map((c, i, all) => ({
				date: c.date,
				col: c.col,
				span: (all[i + 1]?.col ?? range.days) - c.col
			}))
	);
	const px = (cols: number) => `${cols * range.dayWidth}px`;
	const colOf = (date: string) => diffDays(range.from, date);
	const inRange = (date: string | null): date is string =>
		!!date && date >= range.from && date <= range.to;
	const monthLabel = (date: string) =>
		wide ? `${Number(date.slice(5, 7))}月` : `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`;
	const period = (d: Dated) => {
		const s = d.startDate ?? d.dueDate;
		const e = d.dueDate ?? d.startDate;
		return s === e ? shortDate(s!) : `${shortDate(s!)} – ${shortDate(e!)}`;
	};
	const tooltip = (item: T) =>
		[
			`${projectKey}-${item.number} ${item.title}`,
			period(item),
			`${statusName(page.data.statuses, item.status)} / ${item.assignees.map((u) => u.name).join('、') || '未割当'}`
		].join('\n');
	const href = (item: T) => `/projects/${projectKey}/issues/${item.number}`;

	/** 'place' は未スケジュール欄からタイムラインへの配置 */
	type Drag = {
		item: T;
		mode: DragMode | 'place';
		startX: number;
		startY: number;
		x: number;
		y: number;
		delta: number;
		moved: boolean;
	};
	let drag = $state<Drag | null>(null);
	let canvas = $state<HTMLDivElement>();
	/** ドラッグ直後のクリック（リンク遷移）を 1 回だけ止める */
	let suppressClick = false;

	function begin(e: PointerEvent, item: T, mode: Drag['mode']) {
		if (!item.canEdit || !onsave || e.button !== 0) return;
		// リンクのネイティブなドラッグと文字選択を止める（click は止まらない）
		e.preventDefault();
		e.stopPropagation();
		drag = {
			item,
			mode,
			startX: e.clientX,
			startY: e.clientY,
			x: e.clientX,
			y: e.clientY,
			delta: 0,
			moved: false
		};
	}

	function move(e: PointerEvent) {
		if (resize) {
			labelW = clampLabel(resize.startW + e.clientX - resize.startX);
			return;
		}
		if (!drag) return;
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		drag.moved ||= Math.hypot(dx, dy) >= CLICK_SLOP;
		drag.delta = dragDelta(dx, range.dayWidth);
		drag.x = e.clientX;
		drag.y = e.clientY;
	}

	/** ポインタ位置の日付。タイムライン（見出しを含む）の外なら null */
	function dateAt(x: number, y: number): string | null {
		if (!canvas) return null;
		const r = canvas.getBoundingClientRect();
		if (y < r.top || y > r.bottom) return null;
		const col = Math.floor((x - r.left - labelW) / range.dayWidth);
		return col >= 0 && col < range.days ? addDays(range.from, col) : null;
	}

	function end() {
		if (resize) {
			resize = null;
			saveLabelW();
			return;
		}
		const d = drag;
		drag = null;
		if (!d) {
			// Escape で中止した操作は、離した位置のリンクへ遷移させない
			if (suppressClick) setTimeout(() => (suppressClick = false));
			return;
		}
		if (!d.moved || !onsave) return;
		suppressClick = true;
		setTimeout(() => (suppressClick = false));
		if (d.mode === 'place') {
			const date = dateAt(d.x, d.y);
			if (date) onsave(d.item, { startDate: date, dueDate: date });
		} else if (d.delta !== 0) {
			onsave(d.item, applyDrag(d.item, d.mode, d.delta));
		}
	}

	/** 修飾キー付き・中クリックはブラウザの既定（新しいタブなど）に任せる。ドラッグ直後のクリックは無視する */
	function openSheet(e: MouseEvent, item: T) {
		if (suppressClick) {
			e.preventDefault();
			return;
		}
		if (!onopen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		onopen(item);
	}

	/** ドラッグ中のバーは移動後の日付で描く */
	const shown = (item: T): Dated =>
		drag?.moved && drag.item.id === item.id && drag.mode !== 'place'
			? applyDrag(item, drag.mode, drag.delta)
			: item;
	const canPlace = $derived(!!onsave && unscheduled.some((i) => i.canEdit));
</script>

<svelte:window
	onpointermove={move}
	onpointerup={end}
	onpointercancel={() => {
		resize = null;
		drag = null;
		suppressClick = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && drag) {
			suppressClick = true;
			drag = null;
		}
	}}
/>

<div class="grid-wrap" class:resizing={!!resize} style:--label-w="{labelW}px">
	<div class="scroller" bind:this={scroller} onscroll={() => syncScroll(scroller, hbar)}>
		<div
			class="canvas"
			bind:this={canvas}
			style:width="{labelW + width}px"
			style:--day-w="{range.dayWidth}px"
		>
			<div class="head">
				<div class="row months">
					<div class="name"></div>
					<div class="track">
						{#each months as m (m.date)}
							<div class="month" style:left={px(m.col)} style:width={px(m.span)}>
								<span>{monthLabel(m.date)}</span>
							</div>
						{/each}
					</div>
				</div>
				<div class="row days">
					<div class="name">
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<div
							class="resizer"
							role="separator"
							aria-orientation="vertical"
							aria-label="課題名の列幅"
							aria-valuemin={LABEL_W_MIN}
							aria-valuemax={LABEL_W_MAX}
							aria-valuenow={labelW}
							tabindex="0"
							title="ドラッグで列幅を変更（ダブルクリックで元に戻す）"
							data-testid="label-resizer"
							onpointerdown={beginResize}
							ondblclick={() => {
								labelW = LABEL_W_DEFAULT;
								saveLabelW();
							}}
							onkeydown={resizeKey}
						></div>
					</div>
					<div class="track gridlines" class:fine={!wide}>
						{#each cells as c (c.date)}
							<div
								class="day"
								class:off={c.off}
								style:left={px(c.col)}
								style:width={px(1)}
								data-date={c.date}
								title={c.holiday}
							>
								{#if wide}
									<span>{Number(c.date.slice(8))}</span>
									<small>{WEEKDAYS[weekday(c.date)]}</small>
								{:else if weekday(c.date) === 1}
									<span class="tick">{shortDate(c.date)}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="body">
				<div class="overlay gridlines" class:fine={!wide} aria-hidden="true">
					{#each cells as c (c.date)}
						{#if c.off}<div class="offday" style:left={px(c.col)} style:width={px(1)}></div>{/if}
					{/each}
					{#if inRange(today)}
						<div class="today" style:left="{(colOf(today) + 0.5) * range.dayWidth}px"></div>
					{/if}
				</div>

				{#each groups as g (g.key)}
					<div class="group">
						{#if g.label !== null}
							<div class="row group-head">
								<div class="name">
									<span class="truncate">{g.label}</span>
									<span class="count" title="完了 / 全体">{g.done}/{g.total}</span>
								</div>
								<div class="track"></div>
							</div>
						{/if}
						{#each g.items as item (item.id)}
							{@const dates = shown(item)}
							{@const span = barSpan(dates, range)}
							{@const grip =
								item.canEdit &&
								!!onsave &&
								span?.kind === 'in' &&
								(span.endCol - span.startCol + 1) * range.dayWidth >= MIN_GRIP_W}
							<div class="row" class:selected={selected === item.number}>
								<div class="name">
									<a
										href={href(item)}
										class="open"
										data-testid={`open-${item.number}`}
										onclick={(e) => openSheet(e, item)}
									>
										<span class="mono key">{projectKey}-{item.number}</span>
										<span class="truncate">{item.title}</span>
									</a>
									{#if span?.kind === 'before' || span?.kind === 'after'}
										<button
											type="button"
											class="icon-btn jump"
											aria-label={`${projectKey}-${item.number} の期間を表示`}
											onclick={() => onjump(defaultFrom(item.startDate ?? item.dueDate!))}
										>
											{#if span.kind === 'before'}<ChevronLeft size={14} />{:else}<ChevronRight
													size={14}
												/>{/if}
										</button>
									{/if}
								</div>
								<div class="track">
									{#if span?.kind === 'in'}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<a
											href={href(item)}
											class="bar"
											class:editable={item.canEdit && !!onsave}
											class:dragging={drag?.moved && drag.item.id === item.id}
											class:done={item.status === DONE_STATUS}
											class:clip-start={span.clippedStart}
											class:clip-end={span.clippedEnd}
											class:open-start={span.missingStart}
											class:open-end={span.missingDue}
											style:left={px(span.startCol)}
											style:width={px(span.endCol - span.startCol + 1)}
											style:--c={statusColor(page.data.statuses, item.status)}
											data-testid={`bar-${item.number}`}
											data-start={dates.startDate ?? ''}
											data-due={dates.dueDate ?? ''}
											title={tooltip(item)}
											draggable="false"
											onpointerdown={(e) => begin(e, item, 'move')}
											onclick={(e) => openSheet(e, item)}
										>
											{#if grip && !span.clippedStart}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													class="handle start"
													data-handle="start"
													onpointerdown={(e) => begin(e, item, 'start')}
												></span>
											{/if}
											<span class="bar-text">{projectKey}-{item.number}</span>
											{#if grip && !span.clippedEnd}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													class="handle end"
													data-handle="end"
													onpointerdown={(e) => begin(e, item, 'end')}
												></span>
											{/if}
										</a>
										{#if drag?.moved && drag.item.id === item.id}
											<span class="drag-label" style:left={px(span.startCol)} style:top="-2px"
												>{period(dates)}</span
											>
										{/if}
									{/if}
								</div>
							</div>
						{/each}
						{#if inRange(g.releaseDate)}
							<div
								class="release"
								style:left="calc(var(--label-w) + {(colOf(g.releaseDate) + 0.5) *
									range.dayWidth}px)"
								title={`${g.label} リリース ${shortDate(g.releaseDate)}`}
							>
								<span>{g.label}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
	<div class="hbar">
		<div
			class="hbar-scroll"
			bind:this={hbar}
			data-testid="timeline-hscroll"
			onscroll={() => syncScroll(hbar, scroller)}
		>
			<div style:width="{width}px"></div>
		</div>
	</div>
</div>

{#if unscheduled.length > 0}
	<section class="unscheduled" aria-label="未スケジュール">
		<h2>未スケジュール <span class="count">{unscheduled.length}</span></h2>
		{#if canPlace}
			<p class="hint">タイムラインへドラッグすると、その日を開始日と期限に設定します。</p>
		{/if}
		<ul>
			{#each unscheduled as item (item.id)}
				<li>
					<a
						href={href(item)}
						class="chip"
						class:editable={item.canEdit && !!onsave}
						data-testid={`chip-${item.number}`}
						title={item.title}
						draggable="false"
						onpointerdown={(e) => begin(e, item, 'place')}
						onclick={(e) => openSheet(e, item)}
					>
						<span class="mono">{projectKey}-{item.number}</span>
						<span class="truncate">{item.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if drag?.mode === 'place' && drag.moved}
	{@const target = dateAt(drag.x, drag.y)}
	<div class="ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 12}px">
		{projectKey}-{drag.item.number}{target ? ` → ${shortDate(target)}` : ''}
	</div>
{/if}

<style>
	/* 親の grid の中でカレンダーの幅に引き伸ばされず、ページ幅に収まるようにする */
	.grid-wrap {
		min-width: 0;
	}
	.scroller {
		overflow-x: auto;
		/* 横スクロールバーは下の .hbar に任せる */
		scrollbar-width: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		background: var(--card);
	}
	.scroller::-webkit-scrollbar {
		display: none;
	}
	/* カレンダー部分の下に、画面下端へ張り付く横スクロールバー */
	.hbar {
		position: sticky;
		bottom: 0;
		z-index: 5;
		border: 1px solid var(--border);
		border-top: 0;
		border-radius: 0 0 var(--radius-md) var(--radius-md);
		background: var(--card);
	}
	/* カレンダー部分の幅だけに出す */
	.hbar-scroll {
		margin-left: var(--label-w);
		overflow-x: auto;
		overflow-y: hidden;
	}
	.hbar-scroll > div {
		height: 1px;
	}
	/* macOS のオーバーレイ表示でも常に見えるようにする */
	.hbar-scroll::-webkit-scrollbar {
		height: 18px;
	}
	.hbar-scroll::-webkit-scrollbar-track {
		background: color-mix(in oklch, var(--c-gray) 10%, var(--card));
	}
	.hbar-scroll::-webkit-scrollbar-thumb {
		border: 4px solid transparent;
		border-radius: 9px;
		background-clip: padding-box;
		background-color: color-mix(in oklch, var(--muted-foreground) 50%, transparent);
	}
	.hbar-scroll::-webkit-scrollbar-thumb:hover {
		background-color: color-mix(in oklch, var(--muted-foreground) 75%, transparent);
	}
	.resizing,
	.resizing * {
		cursor: col-resize !important;
		user-select: none;
	}
	.resizer {
		position: absolute;
		top: -24px;
		right: -4px;
		bottom: 0;
		z-index: 4;
		width: 8px;
		cursor: col-resize;
		touch-action: none;
	}
	.resizer:hover,
	.resizer:focus-visible,
	.resizing .resizer {
		outline: none;
		background: linear-gradient(to right, transparent 3px, var(--primary) 3px 5px, transparent 5px);
	}
	.canvas {
		position: relative;
		min-width: 100%;
	}
	.row {
		display: grid;
		grid-template-columns: var(--label-w) 1fr;
		height: 32px;
		border-bottom: 1px solid var(--border);
	}
	.name {
		position: sticky;
		left: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 0 8px;
		background: var(--card);
		border-right: 1px solid var(--border);
		font-size: 13px;
	}
	.track {
		position: relative;
	}
	.head .row {
		height: 24px;
	}
	.month {
		position: absolute;
		top: 0;
		bottom: 0;
		padding: 0 6px;
		border-left: 1px solid var(--border);
		font-size: 12px;
		font-weight: 600;
		line-height: 24px;
		white-space: nowrap;
	}
	/* 横スクロールで月の始まりが隠れても、月名はタイトル列の右に残す */
	.month span {
		position: sticky;
		left: calc(var(--label-w) + 6px);
	}
	.day {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 1px;
		font-size: 11px;
		line-height: 24px;
		white-space: nowrap;
	}
	.day small {
		font-size: 9px;
	}
	.day.off {
		color: var(--muted-foreground);
		background: color-mix(in oklch, var(--c-gray) 14%, transparent);
	}
	.day .tick {
		position: absolute;
		left: 0;
	}
	.body {
		position: relative;
	}
	.overlay {
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--label-w);
		right: 0;
		pointer-events: none;
	}
	/* 日の仕切り。各日の左端に 1px の線を引く（週スケールは細かいので薄く） */
	.gridlines {
		--line: var(--border);
		background-image: repeating-linear-gradient(
			to right,
			var(--line) 0 1px,
			transparent 1px var(--day-w)
		);
	}
	.gridlines.fine {
		--line: color-mix(in oklch, var(--border) 55%, transparent);
	}
	.offday {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in oklch, var(--c-gray) 14%, transparent);
	}
	.today {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 2px dotted var(--primary);
	}
	.group {
		position: relative;
	}
	.group-head .name {
		font-weight: 600;
	}
	.count {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 12px;
		font-weight: 400;
		color: var(--muted-foreground);
	}
	.key {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.open {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 6px;
		align-self: stretch;
		min-width: 0;
		color: inherit;
	}
	.open:hover .truncate {
		text-decoration: underline;
	}
	.row.selected .name {
		background: color-mix(in oklch, var(--primary) 10%, var(--card));
		box-shadow: inset 3px 0 0 var(--primary);
	}
	.truncate {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.jump {
		margin-left: auto;
		flex-shrink: 0;
	}
	.release {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 2;
		border-left: 2px solid var(--c-amber);
		pointer-events: none;
	}
	.release span {
		position: absolute;
		top: 2px;
		left: 4px;
		font-size: 11px;
		white-space: nowrap;
		color: var(--c-amber);
	}
	.bar {
		position: absolute;
		top: 6px;
		height: 20px;
		z-index: 1;
		display: flex;
		align-items: center;
		padding: 0 6px;
		overflow: hidden;
		border: 1px solid var(--c);
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--c) 28%, var(--card));
		color: var(--foreground);
		font-size: 11px;
		white-space: nowrap;
		user-select: none;
	}
	.bar.done {
		opacity: 0.5;
	}
	.bar.open-start {
		border-left-style: dashed;
	}
	.bar.open-end {
		border-right-style: dashed;
	}
	.bar.clip-start {
		clip-path: polygon(6px 0, 100% 0, 100% 100%, 6px 100%, 0 50%);
	}
	.bar.clip-end {
		clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%);
	}
	.bar.bar:focus-visible {
		clip-path: none;
	}
	.bar.clip-start.clip-end {
		clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 6px 100%, 0 50%);
	}
	.bar-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.unscheduled {
		display: grid;
		gap: 8px;
	}
	.unscheduled h2 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 700;
	}
	.unscheduled ul {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 280px;
		height: 28px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
		font-size: 13px;
		user-select: none;
	}
	.chip .mono {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.bar.editable {
		cursor: grab;
		touch-action: none;
	}
	.bar.dragging {
		cursor: grabbing;
		box-shadow: 0 0 0 2px var(--ring-soft);
	}
	.handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 8px;
		cursor: ew-resize;
		touch-action: none;
	}
	.handle.start {
		left: 0;
	}
	.handle.end {
		right: 0;
	}
	.drag-label {
		position: absolute;
		z-index: 4;
		transform: translateY(-100%);
		padding: 0 4px;
		border-radius: 3px;
		background: var(--foreground);
		color: var(--card);
		font-size: 11px;
		white-space: nowrap;
		pointer-events: none;
	}
	.chip.editable {
		cursor: grab;
		touch-action: none;
	}
	.ghost {
		position: fixed;
		z-index: 50;
		padding: 2px 8px;
		border: 1px solid var(--primary);
		border-radius: var(--radius-sm);
		background: var(--card);
		font-size: 12px;
		pointer-events: none;
	}
	.unscheduled h2 .count {
		margin-left: 0;
	}
</style>
