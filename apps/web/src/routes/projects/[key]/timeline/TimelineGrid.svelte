<script lang="ts" generics="T extends TimelineIssue & { title: string; canEdit: boolean }">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { STATUS_COLOR, STATUS_LABEL } from '$lib/labels';
	import {
		barSpan,
		dayCells,
		defaultFrom,
		diffDays,
		shortDate,
		weekday,
		type Dated,
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
		// TODO(Task 5): ドラッグ編集で使う。今は受け取るだけ
		onsave?: (item: T, next: Dated) => void;
	}
	// eslint-disable-next-line svelte/no-unused-props
	let { projectKey, groups, unscheduled, range, today, onjump }: Props = $props();

	const LABEL_W = 240;
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
			`${STATUS_LABEL[item.status]} / ${item.assigneeName ?? '未割当'}`
		].join('\n');
	const href = (item: T) => `/projects/${projectKey}/issues/${item.number}`;
</script>

<div class="scroller">
	<div class="canvas" style:width="{LABEL_W + width}px" style:--label-w="{LABEL_W}px">
		<div class="head">
			<div class="row months">
				<div class="name"></div>
				<div class="track">
					{#each months as m (m.date)}
						<div class="month" style:left={px(m.col)} style:width={px(m.span)}>
							{monthLabel(m.date)}
						</div>
					{/each}
				</div>
			</div>
			<div class="row days">
				<div class="name"></div>
				<div class="track">
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
			<div class="overlay" aria-hidden="true">
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
						{@const span = barSpan(item, range)}
						<div class="row">
							<div class="name">
								<a href={href(item)} class="mono key">{projectKey}-{item.number}</a>
								<span class="truncate">{item.title}</span>
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
									<a
										href={href(item)}
										class="bar"
										class:done={item.status === 'done'}
										class:clip-start={span.clippedStart}
										class:clip-end={span.clippedEnd}
										class:open-start={span.missingStart}
										class:open-end={span.missingDue}
										style:left={px(span.startCol)}
										style:width={px(span.endCol - span.startCol + 1)}
										style:--c={STATUS_COLOR[item.status]}
										data-testid={`bar-${item.number}`}
										data-start={item.startDate ?? ''}
										data-due={item.dueDate ?? ''}
										title={tooltip(item)}
										draggable="false"
									>
										<span class="bar-text">{projectKey}-{item.number}</span>
									</a>
								{/if}
							</div>
						</div>
					{/each}
					{#if inRange(g.releaseDate)}
						<div
							class="release"
							style:left="calc(var(--label-w) + {(colOf(g.releaseDate) + 0.5) * range.dayWidth}px)"
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

{#if unscheduled.length > 0}
	<section class="unscheduled" aria-label="未スケジュール">
		<h2>未スケジュール <span class="count">{unscheduled.length}</span></h2>
		<p class="hint">タイムラインへドラッグすると、その日を開始日と期限に設定します。</p>
		<ul>
			{#each unscheduled as item (item.id)}
				<li>
					<a
						href={href(item)}
						class="chip"
						class:editable={item.canEdit}
						data-testid={`chip-${item.number}`}
						title={item.title}
						draggable="false"
					>
						<span class="mono">{projectKey}-{item.number}</span>
						<span class="truncate">{item.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.scroller {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--card);
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
	.key:hover {
		text-decoration: underline;
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
		border-radius: 4px;
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
		border-radius: 4px;
		background: var(--card);
		font-size: 13px;
		user-select: none;
	}
	.chip .mono {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--muted-foreground);
	}
</style>
