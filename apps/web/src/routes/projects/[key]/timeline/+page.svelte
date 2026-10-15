<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { milestoneLabel, todayJst } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import {
		addDays,
		groupItems,
		parseView,
		viewRange,
		type Dated,
		type GroupBy,
		type Scale
	} from '$lib/timeline';
	import TimelineGrid from './TimelineGrid.svelte';
	import { getTimeline, setIssueDates } from './timeline.remote';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const today = todayJst();
	const view = $derived(parseView(new URLSearchParams(page.url.search), today));
	const ref = $derived({ key: params.key, milestone: view.milestone });
	const timeline = $derived(await getTimeline(ref));
	const range = $derived(viewRange(view.from, view.scale));

	/** 保存中の楽観的な日付（issue id → 日付）。保存が終われば消す */
	let pending = $state<Record<string, Dated>>({});
	const all = $derived(
		[...timeline.scheduled, ...timeline.unscheduled].map((i) =>
			pending[i.id] ? { ...i, ...pending[i.id] } : i
		)
	);
	const scheduled = $derived(all.filter((i) => i.startDate || i.dueDate));
	const unscheduled = $derived(all.filter((i) => !i.startDate && !i.dueDate));
	const groups = $derived(groupItems(scheduled, view.group, timeline.milestones));

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
				...ref,
				number: item.number,
				startDate: next.startDate ?? '',
				dueDate: next.dueDate ?? ''
			});
		} catch (err) {
			toast.error(failure(err));
			getTimeline(ref)
				.refresh()
				.catch(() => {});
		} finally {
			delete pending[item.id];
		}
	}

	/** 値が '' のキーはクエリから消す（既定値に戻る） */
	function setQuery(patch: Partial<Record<'group' | 'scale' | 'from' | 'milestone', string>>) {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(patch)) {
			if (v) url.searchParams.set(k, v);
			else url.searchParams.delete(k);
		}
		goto(url, { replace: true, reset: false });
	}
</script>

<section class="grid gap-4">
	<div class="flex flex-wrap items-end gap-3">
		<div class="field gap-1.5">
			<span class="label text-[13px]" id="tl-group">グループ</span>
			<div class="seg" role="group" aria-labelledby="tl-group">
				{#each GROUP_OPTIONS as [value, label] (value)}
					<button
						type="button"
						class="btn btn-sm {view.group === value ? 'btn-primary' : 'btn-outline'}"
						aria-pressed={view.group === value}
						onclick={() => setQuery({ group: value === 'assignee' ? '' : value })}>{label}</button
					>
				{/each}
			</div>
		</div>
		{#if timeline.milestones.length > 0}
			<div class="field w-56 gap-1.5">
				<label class="label text-[13px]" for="tl-milestone">マイルストーン</label>
				<select
					class="select"
					id="tl-milestone"
					value={view.milestone}
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
		<div class="field gap-1.5">
			<span class="label text-[13px]" id="tl-scale">表示</span>
			<div class="seg" role="group" aria-labelledby="tl-scale">
				{#each SCALE_OPTIONS as [value, label] (value)}
					<button
						type="button"
						class="btn btn-sm {view.scale === value ? 'btn-primary' : 'btn-outline'}"
						aria-pressed={view.scale === value}
						onclick={() => setQuery({ scale: value === 'day' ? '' : value })}>{label}</button
					>
				{/each}
			</div>
		</div>
		<div class="ml-auto flex gap-1">
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onclick={() => setQuery({ from: addDays(range.from, -range.step) })}
				><ChevronLeft size={16} />前</button
			>
			<button type="button" class="btn btn-outline btn-sm" onclick={() => setQuery({ from: '' })}
				>今日</button
			>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onclick={() => setQuery({ from: addDays(range.from, range.step) })}
				>次<ChevronRight size={16} /></button
			>
		</div>
	</div>

	{#if groups.length === 0 && unscheduled.length === 0}
		<div class="empty"><div class="empty-title">表示できる課題はありません</div></div>
	{:else}
		<TimelineGrid
			projectKey={params.key}
			{groups}
			{unscheduled}
			{range}
			{today}
			onjump={(from) => setQuery({ from })}
			onsave={save}
		/>
	{/if}
</section>

<style>
	.seg {
		display: flex;
		gap: 4px;
	}
</style>
