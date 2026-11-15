<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { CircleCheck, TriangleAlert } from '@lucide/svelte';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import {
		formatIssueImportResult,
		MAX_CSV_BYTES,
		readBacklogIssues,
		type BacklogIssueRow
	} from '#lib/backlog-issues.ts';
	import { decodeCsv } from '#lib/csv.ts';
	import { previewIssueImport, runIssueImport } from './issue-import.remote';

	let { projectKey }: { projectKey: string } = $props();

	type Plan = Awaited<ReturnType<typeof previewIssueImport>>;
	type Person = Plan['people'][number];

	const MATCH_LABEL: Record<Person['match'], string> = {
		auto: '名前が一致',
		ambiguous: '同じ名前のユーザーが複数います',
		pending: '招待中（未承諾）',
		none: '該当なし'
	};

	let input = $state<HTMLInputElement>();
	/** 確認画面。実行時は CSV の行と人の対応表を送る（サーバーが計画を作り直す） */
	let preview = $state.raw<{ plan: Plan; rows: BacklogIssueRow[] } | null>(null);
	/** Backlog の名前ごとの対応先の user id。'' は不明なユーザー */
	let chosen = $state<Record<string, string>>({});
	let pending = $state(false);
	let message = $state('');
	let result = $state('');

	const usersById = $derived(new Map((preview?.plan.users ?? []).map((u) => [u.id, u])));
	const unmatched = $derived((preview?.plan.people ?? []).filter((p) => !chosen[p.name]));
	const created = $derived.by(() => {
		const c = preview?.plan.created;
		if (!c) return [];
		const kinds: [string, string[]][] = [
			['ステータス', c.statuses],
			['種別', c.types],
			['カテゴリー', c.categories],
			['マイルストーン', c.milestones]
		];
		return kinds.filter(([, names]) => names.length > 0);
	});
	const summary = $derived.by(() => {
		if (!preview) return '';
		const { issues, comments, firstNumber } = preview.plan;
		if (issues === 0) return '取り込める課題がありません';
		const last = firstNumber + issues - 1;
		const range = issues === 1 ? `#${firstNumber}` : `#${firstNumber}〜#${last}`;
		return `課題 ${issues} 件（${range}）とコメント ${comments} 件を取り込みます`;
	});

	const usesText = (u: Person['uses']) =>
		[
			u.reporter > 0 && `登録 ${u.reporter}`,
			u.assignee > 0 && `担当 ${u.assignee}`,
			u.comment > 0 && `コメント ${u.comment}`
		]
			.filter(Boolean)
			.join('・');

	/** 400・409 はサーバーの文言を出し、それ以外は fallback を出す */
	const failure = (err: unknown, fallback: string) => {
		const { status, body } = (err ?? {}) as { status?: number; body?: { message?: string } };
		return (status === 400 || status === 409) && body?.message ? body.message : fallback;
	};

	/** 確認画面を閉じる。同じ CSV を選び直しても読み込めるように選択も空にする */
	function close() {
		preview = null;
		if (input) input.value = '';
	}

	async function pick(file: File | undefined) {
		preview = null;
		message = '';
		result = '';
		if (!file) return;
		if (file.size > MAX_CSV_BYTES) {
			message = 'CSV が大きすぎます（10MB まで）。Backlog で絞り込んで CSV を分けてください';
			close();
			return;
		}
		const read = readBacklogIssues(decodeCsv(new Uint8Array(await file.arrayBuffer())));
		if (!read.ok) {
			message = read.message;
			close();
			return;
		}
		pending = true;
		try {
			const plan = await previewIssueImport({ key: projectKey, rows: read.rows });
			chosen = Object.fromEntries(plan.people.map((p) => [p.name, p.userId ?? '']));
			preview = { plan, rows: read.rows };
		} catch (err) {
			message = failure(err, '読み込めませんでした');
			close();
		} finally {
			pending = false;
		}
	}

	async function run() {
		if (!preview) return;
		pending = true;
		message = '';
		try {
			const r = await runIssueImport({
				key: projectKey,
				rows: preview.rows,
				people: preview.plan.people.map((p) => ({ name: p.name, userId: chosen[p.name] || null }))
			});
			close();
			result = formatIssueImportResult(r);
			// 作ったステータス・カテゴリーや参加者を、同じ画面の一覧に出す
			await invalidateAll();
		} catch (err) {
			message = failure(err, '取り込めませんでした。何も書き込んでいません');
		} finally {
			pending = false;
		}
	}
</script>

<div class="card">
	<div class="card-head">
		<h2 class="card-title">Backlog の CSV から課題を取り込む</h2>
		<p class="card-desc">
			Backlog の課題一覧からエクスポートした CSV
			を読み込み、このプロジェクトに課題とコメントを取り込みます。取り込んでも通知は送りません。
		</p>
	</div>
	<div class="field max-w-[420px]">
		<label class="label" for="backlog-issues-csv">課題 CSV</label>
		<input
			bind:this={input}
			class="input"
			id="backlog-issues-csv"
			type="file"
			accept=".csv,text/csv"
			disabled={pending}
			onchange={(e) => pick(e.currentTarget.files?.[0])}
		/>
	</div>
	{#if message}<FormAlert {message} />{/if}
	{#if result}
		<div role="status" class="alert" data-testid="issue-import-result">
			<CircleCheck color="var(--c-green)" />
			<div class="grid gap-1">
				<p class="m-0">{result}</p>
				<a class="link" href={`/projects/${projectKey}`}>課題一覧を見る</a>
			</div>
		</div>
	{/if}

	{#if preview}
		{@const { plan } = preview}
		<div class="grid gap-4">
			<p class="m-0 font-medium" data-testid="issue-import-summary">{summary}</p>

			{#if plan.alreadyImported.length > 0}
				<FormAlert
					message={`既に取り込んだ課題があります: ${plan.alreadyImported.join('、')}。取り込み済みの課題を除いた CSV を使ってください`}
				/>
			{/if}
			{#if plan.backlogProjects.length > 1}
				<div class="alert">
					<TriangleAlert color="var(--c-amber)" />
					<p class="m-0">
						複数の Backlog プロジェクトの課題が含まれています: <span class="mono"
							>{plan.backlogProjects.join('、')}</span
						>
					</p>
				</div>
			{/if}

			{#if created.length > 0}
				<div class="grid gap-1" data-testid="issue-import-created">
					<p class="m-0 text-[0.8125rem] font-medium">新しく作るもの</p>
					{#each created as [label, names] (label)}
						<p class="m-0 text-[0.8125rem]">{label}: {names.join('、')}</p>
					{/each}
				</div>
			{/if}

			{#if plan.rowErrors.length > 0}
				<div class="alert">
					<TriangleAlert color="var(--c-amber)" />
					<div class="grid gap-1" data-testid="issue-import-row-errors">
						<p class="m-0">次の行は取り込みません</p>
						<ul class="m-0 grid gap-0.5 pl-5 text-[0.8125rem]">
							{#each plan.rowErrors as e (e.rowNumber)}
								<li>{e.rowNumber} 行目（{e.key || 'キーなし'}）: {e.reason}</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}

			{#if plan.people.length > 0}
				{#if unmatched.length > 0}
					<div class="alert">
						<TriangleAlert color="var(--c-amber)" />
						<div class="grid gap-1">
							<p class="m-0">
								対応するユーザーがいない人がいます。ユーザー CSV
								を取り込むか、メールで招待して承諾されてから取り込んでください。このまま取り込むと「不明なユーザー」として登録します（担当者は空にし、元の名前を本文に残します）。
							</p>
							{#if unmatched.some((p) => p.match === 'pending')}
								<p class="m-0">
									未承諾の招待がある人がいます。承諾後に取り込むと本人として登録されます。今続けると不明なユーザーになり、後から付け替えられません。
								</p>
							{/if}
						</div>
					</div>
				{/if}
				<div
					class="grid-table preview"
					style="--cols: minmax(128px, 1fr) minmax(128px, 0.9fr) minmax(220px, 1.4fr) minmax(144px, 1fr)"
				>
					<div role="table" aria-label="人の対応付け" style="min-width: 680px">
						<div role="row" class="grid-table-head">
							<span role="columnheader">Backlog の名前</span>
							<span role="columnheader">登場</span>
							<span role="columnheader">このツールのユーザー</span>
							<span role="columnheader">メモ</span>
						</div>
						{#each plan.people as person (person.name)}
							{@const selected = usersById.get(chosen[person.name])}
							<div role="row" class="row">
								<span role="cell" class="truncate font-medium">{person.name}</span>
								<span role="cell" class="text-[0.8125rem] text-muted-foreground"
									>{usesText(person.uses)}</span
								>
								<span role="cell">
									<select
										class="select w-full"
										aria-label={`${person.name} の対応先`}
										bind:value={chosen[person.name]}
										disabled={pending}
									>
										<option value="">不明なユーザー</option>
										{#each plan.users as u (u.id)}
											<option value={u.id}>{u.name}（{u.email}）</option>
										{/each}
									</select>
								</span>
								<span role="cell" class="grid text-[0.8125rem]">
									<span>{MATCH_LABEL[person.match]}</span>
									{#if selected && !selected.member}
										<span class="text-muted-foreground">プロジェクトに参加します</span>
									{/if}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="flex gap-2">
				<button
					type="button"
					class="btn btn-primary"
					disabled={pending || plan.issues === 0 || plan.alreadyImported.length > 0}
					onclick={run}>取り込む（{plan.issues} 件）</button
				>
				<button type="button" class="btn btn-outline" disabled={pending} onclick={close}
					>やめる</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	/* 人が多くても実行ボタンが遠くならないよう、表の中でスクロールする */
	.preview {
		max-height: 480px;
		overflow-y: auto;
	}
	.preview .grid-table-head {
		position: sticky;
		top: 0;
		z-index: 1;
		background: color-mix(in oklch, var(--muted) 70%, var(--card));
	}
	.row {
		min-height: 52px;
		padding-block: 8px;
	}
</style>
