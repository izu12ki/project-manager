<script lang="ts">
	import { ChevronLeft, ChevronRight, SearchX } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { milestoneLabel, todayJst } from '#lib/labels.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import {
		addDays,
		groupItems,
		lastDate,
		parseView,
		timelineArg,
		viewRange,
		type Dated,
		type GroupBy,
		type Scale
	} from '#lib/timeline.ts';
	import IssueSheet from '../IssueSheet.svelte';
	import { getChanges, getIssueDetail } from '../issues/[number=int]/issue.remote';
	import TimelineGrid from './TimelineGrid.svelte';
	import { getTimeline, setIssueDates } from './timeline.remote';
	import type { PageProps } from './$types';

	let { data, params }: PageProps = $props();
	const today = todayJst();
	const view = $derived(parseView(new URLSearchParams(page.url.search), today));
	// 絞り込みと表示の開始日はサーバーで使う（課題の多いプロジェクトで、終わった課題をすべて送らないため）
	const ref = $derived(timelineArg(params.key, view));
	const timeline = $derived(await getTimeline(ref));

	/** 右側のシートで開いている課題の番号 */
	let opened = $state<number | null>(null);
	// プロジェクトを切り替えたらシートを閉じる
	$effect.pre(() => {
		void params.key;
		opened = null;
	});

	/** 保存中の楽観的な日付（issue id → 日付）。保存が終われば消す */
	let pending = $state<Record<string, Dated>>({});
	const scheduled = $derived(
		timeline.scheduled
			.map((i) => (pending[i.id] ? { ...i, ...pending[i.id] } : i))
			.filter((i) => i.startDate || i.dueDate)
	);
	const filtering = $derived(Object.values(view.filters).some(Boolean));
	const groups = $derived(groupItems(scheduled, view.group, timeline.milestones));
	// 最後の期限日の課題まで右に広げる
	const range = $derived(viewRange(view.from, view.scale, lastDate(scheduled)));
	// 日付のない課題は課題一覧で見る。タイムラインの絞り込みを引き継ぐ（ステータスが「すべて」なら一覧の既定の完了以外）
	const unscheduledHref = $derived(
		`/projects/${params.key}?${new URLSearchParams([
			['dates', 'none'],
			...Object.entries(view.filters).filter(([, v]) => v)
		])}`
	);

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
				ref,
				number: item.number,
				startDate: next.startDate ?? '',
				dueDate: next.dueDate ?? ''
			});
			// シートで開いている課題なら、表示中の日付と履歴も取り直す
			if (item.number === opened) {
				const ref = { key: params.key, number: item.number };
				getIssueDetail(ref)
					.refresh()
					.catch(() => {});
				getChanges(ref)
					.refresh()
					.catch(() => {});
			}
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
	type QueryKey =
		'group' | 'scale' | 'from' | 'type' | 'status' | 'assignee' | 'category' | 'milestone';
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
			{#if data.issueTypes.length > 0}
				<div class="field w-36 gap-1.5">
					<label class="label text-[0.8125rem]" for="tl-type">種別</label>
					<select
						class="select"
						id="tl-type"
						value={view.filters.type}
						onchange={(e) => setQuery({ type: e.currentTarget.value })}
					>
						<option value="">すべて</option>
						<option value="none">未設定</option>
						{#each data.issueTypes as t (t.id)}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="field w-40 gap-1.5">
				<label class="label text-[0.8125rem]" for="tl-status">ステータス</label>
				<select
					class="select"
					id="tl-status"
					value={view.filters.status}
					onchange={(e) => setQuery({ status: e.currentTarget.value })}
				>
					<option value="">すべて</option>
					<option value="open">完了以外</option>
					{#each data.statuses as s (s.key)}
						<option value={s.key}>{s.name}</option>
					{/each}
				</select>
			</div>
			{#if timeline.categories.length > 0}
				<div class="field w-40 gap-1.5">
					<label class="label text-[0.8125rem]" for="tl-category">カテゴリー</label>
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
					<label class="label text-[0.8125rem]" for="tl-milestone">マイルストーン</label>
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
				<label class="label text-[0.8125rem]" for="tl-assignee">担当者</label>
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
				<label class="label text-[0.8125rem]" for="tl-from">開始日</label>
				<div class="flex items-center gap-1">
					<input
						class="input w-40"
						id="tl-from"
						type="date"
						value={view.from}
						onchange={(e) => setQuery({ from: e.currentTarget.value })}
					/>
					<button type="button" class="btn btn-outline" onclick={() => setQuery({ from: '' })}>
						今日
					</button>
					<button
						type="button"
						class="icon-btn"
						aria-label="前の期間"
						onclick={() => setQuery({ from: addDays(range.from, -range.step) })}
					>
						<ChevronLeft size={18} />
					</button>
					<button
						type="button"
						class="icon-btn"
						aria-label="次の期間"
						onclick={() => setQuery({ from: addDays(range.from, range.step) })}
					>
						<ChevronRight size={18} />
					</button>
				</div>
			</div>
			<div class="field w-24 gap-1.5">
				<label class="label text-[0.8125rem]" for="tl-scale">スケール</label>
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
				<label class="label text-[0.8125rem]" for="tl-group">グルーピング</label>
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

	{#if timeline.unscheduledTotal > 0}
		<p class="hint">
			開始日と期限日が未設定の課題が {timeline.unscheduledTotal.toLocaleString('ja-JP')} 件あります。未設定の課題はタイムラインに表示されません。
			<a href={unscheduledHref} class="link">未設定の課題を一覧で見る</a>
		</p>
	{/if}
	{#if groups.length === 0}
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
					onclick={() =>
						setQuery({ type: '', status: '', assignee: '', category: '', milestone: '' })}
				>
					絞り込みを解除
				</button>
			{:else}
				<div class="empty-title">表示できる課題はありません</div>
			{/if}
		</div>
	{:else}
		{#if timeline.scheduledTotal > timeline.scheduled.length}
			<p class="hint">
				日付のある課題が多いため、表示を始める日に近い {timeline.scheduled.length} 件だけを表示しています（ほか
				{timeline.scheduledTotal - timeline.scheduled.length} 件）。担当者やマイルストーンで絞り込んでください。
			</p>
		{/if}
		<TimelineGrid
			projectKey={params.key}
			{groups}
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
				getTimeline(ref)
					.refresh()
					.catch(() => {})}
		/>
	{/if}
</section>
