<script lang="ts">
	import { ChevronLeft, ChevronRight, SearchX } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { STATUSES, STATUS_LABEL, milestoneLabel, todayJst } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import {
		addDays,
		filterItems,
		groupItems,
		lastDate,
		parseView,
		viewRange,
		type Dated,
		type GroupBy,
		type Scale
	} from '$lib/timeline';
	import IssueSheet from '../IssueSheet.svelte';
	import TimelineGrid from './TimelineGrid.svelte';
	import { getTimeline, setIssueDates } from './timeline.remote';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const today = todayJst();
	const view = $derived(parseView(new URLSearchParams(page.url.search), today));
	const timeline = $derived(await getTimeline(params.key));

	/** 右側のシートで開いている課題の番号 */
	let opened = $state<number | null>(null);
	// プロジェクトを切り替えたらシートを閉じる
	$effect.pre(() => {
		void params.key;
		opened = null;
	});

	/** 保存中の楽観的な日付（issue id → 日付）。保存が終われば消す */
	let pending = $state<Record<string, Dated>>({});
	const all = $derived(
		filterItems(
			[...timeline.scheduled, ...timeline.unscheduled].map((i) =>
				pending[i.id] ? { ...i, ...pending[i.id] } : i
			),
			view.filters
		)
	);
	const filtering = $derived(Object.values(view.filters).some(Boolean));
	const scheduled = $derived(all.filter((i) => i.startDate || i.dueDate));
	const unscheduled = $derived(all.filter((i) => !i.startDate && !i.dueDate));
	const groups = $derived(groupItems(scheduled, view.group, timeline.milestones));
	// 最後の期限日の課題まで右に広げる
	const range = $derived(viewRange(view.from, view.scale, lastDate(scheduled)));

	const GROUP_OPTIONS: [GroupBy, string][] = [
		['assignee', '担当者'],
		['milestone', 'マイルストーン'],
		['none', 'なし']
	];
	const SCALE_OPTIONS: [Scale, string][] = [
		['day', '日'],
		['week', '週']
	];

	/** 400/409 は業務エラーなのでサーバーのメッセージを出し、それ以外は汎用文言にする */
	function failure(err: unknown): string {
		const { status, body } = (err ?? {}) as { status?: number; body?: { message?: string } };
		return (status === 400 || status === 409) && body?.message
			? body.message
			: 'この課題の日付は変更できません';
	}

	async function save(item: { id: string; number: number }, next: Dated) {
		pending[item.id] = next;
		try {
			// 保存と最新の再取得を 1 往復で行う（サーバー側で getTimeline を refresh）
			await setIssueDates({
				key: params.key,
				number: item.number,
				startDate: next.startDate ?? '',
				dueDate: next.dueDate ?? ''
			});
		} catch (err) {
			toast.error(failure(err));
			getTimeline(params.key)
				.refresh()
				.catch(() => {});
		} finally {
			delete pending[item.id];
		}
	}

	/** 値が '' のキーはクエリから消す（既定値に戻る） */
	type QueryKey = 'group' | 'scale' | 'from' | 'status' | 'assignee' | 'category' | 'milestone';
	function setQuery(patch: Partial<Record<QueryKey, string>>) {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(patch)) {
			if (v) url.searchParams.set(k, v);
			else url.searchParams.delete(k);
		}
		goto(url, { replace: true, reset: false });
	}
</script>

<section class="grid gap-4">
	<div class="grid gap-3">
		<div class="flex flex-wrap items-end gap-3">
			<div class="field w-40 gap-1.5">
				<label class="label text-[13px]" for="tl-status">状態</label>
				<select
					class="select"
					id="tl-status"
					value={view.filters.status}
					onchange={(e) => setQuery({ status: e.currentTarget.value })}
				>
					<option value="">すべて</option>
					<option value="open">完了以外</option>
					{#each STATUSES as s (s)}
						<option value={s}>{STATUS_LABEL[s]}</option>
					{/each}
				</select>
			</div>
			{#if timeline.categories.length > 0}
				<div class="field w-40 gap-1.5">
					<label class="label text-[13px]" for="tl-category">カテゴリー</label>
					<select
						class="select"
						id="tl-category"
						value={view.filters.category}
						onchange={(e) => setQuery({ category: e.currentTarget.value })}
					>
						<option value="">すべて</option>
						<option value="none">未設定</option>
						{#each timeline.categories as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
			{/if}
			{#if timeline.milestones.length > 0}
				<div class="field w-48 gap-1.5">
					<label class="label text-[13px]" for="tl-milestone">マイルストーン</label>
					<select
						class="select"
						id="tl-milestone"
						value={view.filters.milestone}
						onchange={(e) => setQuery({ milestone: e.currentTarget.value })}
					>
						<option value="">すべて</option>
						<option value="none">未設定</option>
						{#each timeline.milestones as m (m.id)}
							<option value={m.id}>{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="field w-40 gap-1.5">
				<label class="label text-[13px]" for="tl-assignee">担当者</label>
				<select
					class="select"
					id="tl-assignee"
					value={view.filters.assignee}
					onchange={(e) => setQuery({ assignee: e.currentTarget.value })}
				>
					<option value="">すべて</option>
					<option value="none">未割当</option>
					{#each timeline.assignees as u (u.id)}
						<option value={u.id}>{u.name}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<div class="field gap-1.5">
				<label class="label text-[13px]" for="tl-from">開始日</label>
				<div class="flex items-center gap-1">
					<input
						class="input w-40"
						id="tl-from"
						type="date"
						value={view.from}
						onchange={(e) => setQuery({ from: e.currentTarget.value })}
					/>
					<button type="button" class="btn btn-outline" onclick={() => setQuery({ from: '' })}
						>今日</button
					>
					<button
						type="button"
						class="icon-btn"
						aria-label="前の期間"
						onclick={() => setQuery({ from: addDays(range.from, -range.step) })}
						><ChevronLeft size={18} /></button
					>
					<button
						type="button"
						class="icon-btn"
						aria-label="次の期間"
						onclick={() => setQuery({ from: addDays(range.from, range.step) })}
						><ChevronRight size={18} /></button
					>
				</div>
			</div>
			<div class="field w-24 gap-1.5">
				<label class="label text-[13px]" for="tl-scale">スケール</label>
				<select
					class="select"
					id="tl-scale"
					value={view.scale}
					onchange={(e) =>
						setQuery({ scale: e.currentTarget.value === 'day' ? '' : e.currentTarget.value })}
				>
					{#each SCALE_OPTIONS as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>
			<div class="field w-40 gap-1.5">
				<label class="label text-[13px]" for="tl-group">グルーピング</label>
				<select
					class="select"
					id="tl-group"
					value={view.group}
					onchange={(e) =>
						setQuery({
							group: e.currentTarget.value === 'assignee' ? '' : e.currentTarget.value
						})}
				>
					{#each GROUP_OPTIONS as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>

	{#if groups.length === 0 && unscheduled.length === 0}
		<div class="empty">
			{#if filtering}
				<span class="empty-icon"><SearchX /></span>
				<div class="grid gap-1">
					<div class="empty-title">条件に一致する課題はありません</div>
					<div class="text-muted-foreground">絞り込み条件を変更してください</div>
				</div>
				<button
					type="button"
					class="btn btn-outline"
					onclick={() => setQuery({ status: '', assignee: '', category: '', milestone: '' })}
					>絞り込みを解除</button
				>
			{:else}
				<div class="empty-title">表示できる課題はありません</div>
			{/if}
		</div>
	{:else}
		<TimelineGrid
			projectKey={params.key}
			{groups}
			{unscheduled}
			{range}
			{today}
			onjump={(from) => setQuery({ from })}
			onsave={save}
			onopen={(item) => (opened = item.number)}
			selected={opened}
		/>
	{/if}
	{#if opened !== null}
		<IssueSheet
			projectKey={params.key}
			number={opened}
			onclose={() => (opened = null)}
			onsaved={() =>
				getTimeline(params.key)
					.refresh()
					.catch(() => {})}
		/>
	{/if}
</section>
