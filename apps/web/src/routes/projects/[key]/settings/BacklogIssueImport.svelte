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
	import { convertBacklogRows, keysWithBacklogNotation } from '#lib/backlog-notation.ts';
	import { decodeCsv } from '#lib/csv.ts';
	import { previewIssueImport, runIssueImport } from './issue-import.remote';

	let { projectKey }: { projectKey: string } = $props();

	type Plan = Awaited<ReturnType<typeof previewIssueImport>>;
	type Person = Plan['people'][number];
	type Notation = 'markdown' | 'backlog';

	const MATCH_LABEL: Record<Person['match'], string> = {
		auto: '名前が一致',
		ambiguous: '同じ名前のユーザーが複数います',
		pending: '招待中（未承諾）',
		none: '該当なし'
	};

	let input = $state<HTMLInputElement>();
	/** CSV から読んだままの行 */
	let read = $state.raw<BacklogIssueRow[]>([]);
	/** 本文とコメントの書き方。Backlog 記法なら Markdown に変換して送る */
	let notation = $state<Notation>('markdown');
	/** Backlog 記法が見つかった課題のキー */
	let notationKeys = $state.raw<string[]>([]);
	/** 確認画面。rows は送る行（変換済み）。実行時は行と人の対応表を送る（サーバーが計画を作り直す） */
	let preview = $state.raw<{ plan: Plan; rows: BacklogIssueRow[] } | null>(null);
	/** Backlog の名前ごとの対応先の user id。'' は不明なユーザー */
	let chosen = $state<Record<string, string>>({});
	/** 新しく作るマイルストーンの名前ごとのリリース予定日（'YYYY-MM-DD'。'' は日付なし） */
	let releaseDates = $state<Record<string, string>>({});
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
			['カテゴリー', c.categories]
		];
		return kinds.filter(([, names]) => names.length > 0);
	});
	const summary = $derived.by(() => {
		if (!preview) return '';
		const { issues, comments, firstNumber, lastNumber } = preview.plan;
		if (issues === 0) return '取り込める課題がありません';
		const range =
			firstNumber === lastNumber ? `#${firstNumber}` : `#${firstNumber}〜#${lastNumber}`;
		return `課題 ${issues} 件（${range}）とコメント ${comments} 件を取り込みます`;
	});
	/** 「、」で並べる（多いときは先頭だけ） */
	const keyList = (keys: string[]) =>
		[...keys.slice(0, 10), ...(keys.length > 10 ? [`ほか ${keys.length - 10} 件`] : [])].join('、');

	/** Backlog と違う番号になる課題を、理由ごとに「PROJ-2 → #10」の形で並べる */
	const renumbered = $derived.by(() => {
		const list = preview?.plan.renumbered ?? [];
		const text = (reason: Plan['renumbered'][number]['reason']) =>
			keyList(list.filter((x) => x.reason === reason).map((x) => `${x.key} → #${x.number}`));
		return { taken: text('taken'), key: text('key') };
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
		read = [];
		if (input) input.value = '';
	}

	/** 選んだ書き方で行を作り、確認画面を作り直す。人の対応付けとリリース予定日は入れた分を保つ */
	async function load() {
		const rows = notation === 'backlog' ? convertBacklogRows(read) : read;
		pending = true;
		message = '';
		try {
			const plan = await previewIssueImport({ key: projectKey, rows });
			chosen = Object.fromEntries(
				plan.people.map((p) => [p.name, chosen[p.name] ?? p.userId ?? ''])
			);
			releaseDates = Object.fromEntries(
				plan.created.milestones.map((name) => [name, releaseDates[name] ?? ''])
			);
			preview = { plan, rows };
		} catch (err) {
			message = failure(err, '読み込めませんでした');
			close();
		} finally {
			pending = false;
		}
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
		const parsed = readBacklogIssues(decodeCsv(new Uint8Array(await file.arrayBuffer())));
		if (!parsed.ok) {
			message = parsed.message;
			close();
			return;
		}
		read = parsed.rows;
		notationKeys = keysWithBacklogNotation(read);
		notation = notationKeys.length > 0 ? 'backlog' : 'markdown';
		chosen = {};
		releaseDates = {};
		await load();
	}

	async function run() {
		if (!preview) return;
		pending = true;
		message = '';
		try {
			const r = await runIssueImport({
				key: projectKey,
				rows: preview.rows,
				people: preview.plan.people.map((p) => ({ name: p.name, userId: chosen[p.name] || null })),
				milestones: preview.plan.created.milestones.map((name) => ({
					name,
					releaseDate: releaseDates[name] ?? ''
				}))
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
						複数の Backlog プロジェクトの課題が含まれています: <span class="mono">
							{plan.backlogProjects.join('、')}
						</span>
					</p>
				</div>
			{/if}

			<div class="field max-w-[420px]">
				<label class="label" for="backlog-notation">本文とコメントの書き方</label>
				<select
					class="select w-full"
					id="backlog-notation"
					value={notation}
					disabled={pending}
					onchange={(e) => {
						notation = e.currentTarget.value as Notation;
						load();
					}}
				>
					<option value="markdown">Markdown（そのまま取り込む）</option>
					<option value="backlog">Backlog 記法（Markdown に変換して取り込む）</option>
				</select>
				<p class="m-0 text-[0.8125rem] text-muted-foreground">
					Backlog のプロジェクト設定「テキスト整形のルール」に合わせて選んでください。
				</p>
			</div>
			{#if notationKeys.length > 0}
				<div class="alert" data-testid="issue-import-notation">
					<TriangleAlert color="var(--c-amber)" />
					<p class="m-0">
						{#if notation === 'backlog'}
							次の課題の本文・コメントに Backlog 記法（''太字''、{'{code}'}
							など）があるため、Markdown に変換して取り込みます:
						{:else}
							次の課題の本文・コメントに Backlog 記法（''太字''、{'{code}'}
							など）があります。Markdown のまま取り込むと、記号がそのまま表示されます:
						{/if}
						<span class="mono">{keyList(notationKeys)}</span>
					</p>
				</div>
			{/if}

			{#if renumbered.taken || renumbered.key}
				<div class="alert" data-testid="issue-import-renumbered">
					<TriangleAlert color="var(--c-amber)" />
					<div class="grid gap-1">
						{#if renumbered.taken}
							<p class="m-0">
								次の課題は、同じ番号の課題がこのプロジェクトに既にあるため、Backlog
								と違う番号になります: <span class="mono">{renumbered.taken}</span>
							</p>
						{/if}
						{#if renumbered.key}
							<p class="m-0">
								キーがこのプロジェクトのキー（{projectKey}）と違う課題は、続きの番号になります:
								<span class="mono">{renumbered.key}</span>
							</p>
						{/if}
						<p class="m-0 text-[0.8125rem] text-muted-foreground">
							本文やコメントに書かれたキーは書き換えません。元のキーでも課題一覧のキーワードで探せます。
						</p>
					</div>
				</div>
			{/if}

			{#if created.length > 0 || plan.created.milestones.length > 0}
				<div class="grid gap-1" data-testid="issue-import-created">
					<p class="m-0 text-[0.8125rem] font-medium">新しく作るもの</p>
					{#each created as [label, names] (label)}
						<p class="m-0 text-[0.8125rem]">{label}: {names.join('、')}</p>
					{/each}
					{#if plan.created.milestones.length > 0}
						<div class="grid gap-1.5" data-testid="issue-import-milestones">
							<p class="m-0 text-[0.8125rem]">マイルストーン（リリース予定日）</p>
							{#each plan.created.milestones as name (name)}
								<div class="flex flex-wrap items-center gap-2 pl-3">
									<span class="min-w-[96px] text-[0.8125rem]">{name}</span>
									<input
										class="input w-auto"
										type="date"
										aria-label={`${name} のリリース予定日`}
										bind:value={releaseDates[name]}
										disabled={pending}
									/>
								</div>
							{/each}
							<p class="m-0 text-[0.8125rem] text-muted-foreground">
								CSV には日付が含まれないので、Backlog
								の「バージョン・マイルストーン」の画面を見て入れてください。空欄でも取り込めます。
							</p>
						</div>
					{/if}
				</div>
			{/if}

			{#if plan.extraColumns.length > 0}
				<div class="grid gap-1" data-testid="issue-import-extra-columns">
					<p class="m-0 text-[0.8125rem] font-medium">本文の末尾に残す列</p>
					<p class="m-0 text-[0.8125rem]">
						{plan.extraColumns.join('、')}（対応する項目がないため、値を「列名:
						値」の形で移行情報に残します）
					</p>
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

			{#if plan.longTitles.length > 0}
				<div class="alert" data-testid="issue-import-long-titles">
					<TriangleAlert color="var(--c-amber)" />
					<p class="m-0">
						次の課題は件名が200文字を超えるため、200文字に切り詰めて取り込みます。元の件名は本文の末尾に残します:
						<span class="mono">{plan.longTitles.join('、')}</span>
					</p>
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
								<span role="cell" class="text-[0.8125rem] text-muted-foreground">
									{usesText(person.uses)}
								</span>
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
					onclick={run}
				>
					取り込む（{plan.issues} 件）
				</button>
				<button type="button" class="btn btn-outline" disabled={pending} onclick={close}>
					やめる
				</button>
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
