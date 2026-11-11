<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Archive, CircleCheck, TriangleAlert } from '@lucide/svelte';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import RolePill from '#lib/components/RolePill.svelte';
	import {
		formatImportResult,
		inviteAllowed,
		MAX_IMPORT_USERS,
		readBacklogUsers,
		SKIP_LABEL,
		type BacklogUserRow,
		type ImportRole
	} from '#lib/backlog-users.ts';
	import { decodeCsv } from '#lib/csv.ts';
	import { ROLE_LABEL } from '#lib/labels.ts';
	import { previewUserImport, runUserImport } from './user-import.remote';

	type Plan = Awaited<ReturnType<typeof previewUserImport>>;
	type PlanRow = Plan['rows'][number];

	const roles = ['admin', 'member', 'guest'] as const;

	let input = $state<HTMLInputElement>();
	/** 確認画面。実行時は CSV の行にチェックとロールを足して送る（サーバーが計画を作り直す） */
	let preview = $state.raw<{ plan: Plan; rows: BacklogUserRow[] } | null>(null);
	/** 行番号ごとの招待ロール */
	let roleOf = $state<Record<number, ImportRole>>({});
	/** チェックを外した行番号 */
	let unchecked = $state<Record<number, boolean>>({});
	let pending = $state(false);
	let message = $state('');
	let result = $state('');

	/** 処理対象になる行か。招待は選んだロールで参加プロジェクトなしでも招待できるかが変わる */
	const importable = (r: PlanRow) =>
		r.action === 'join' ||
		(r.action === 'invite' && inviteAllowed(roleOf[r.rowNumber], r.projects.length));
	const count = $derived(
		preview?.plan.rows.filter((r) => importable(r) && !unchecked[r.rowNumber]).length ?? 0
	);

	const failure = (err: unknown) => {
		const { status, body } = (err ?? {}) as { status?: number; body?: { message?: string } };
		return (status === 400 || status === 409) && body?.message
			? body.message
			: '取り込めませんでした';
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
		const read = readBacklogUsers(decodeCsv(new Uint8Array(await file.arrayBuffer())));
		if (!read.ok) {
			message = read.message;
			close();
			return;
		}
		pending = true;
		try {
			const plan = await previewUserImport({ rows: read.rows });
			roleOf = Object.fromEntries(plan.rows.map((r) => [r.rowNumber, r.role]));
			unchecked = {};
			preview = { plan, rows: read.rows };
		} catch (err) {
			message = failure(err);
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
			const r = await runUserImport({
				rows: preview.rows.map((row) => ({
					...row,
					include: !unchecked[row.rowNumber],
					role: roleOf[row.rowNumber]
				}))
			});
			close();
			result = formatImportResult(r);
			await invalidateAll();
		} catch (err) {
			message = failure(err);
		} finally {
			pending = false;
		}
	}
</script>

<div class="card">
	<div class="card-head">
		<h2 class="card-title">Backlog の CSV から招待</h2>
		<p class="card-desc">
			Backlog のスペース設定からエクスポートしたユーザー一覧の CSV
			を読み込み、まとめて招待します。招待した人は、CSV
			の参加プロジェクトと同じキーのプロジェクトに参加します。
		</p>
	</div>
	<div class="field max-w-[420px]">
		<label class="label" for="backlog-users-csv">ユーザー CSV</label>
		<input
			bind:this={input}
			class="input"
			id="backlog-users-csv"
			type="file"
			accept=".csv,text/csv"
			disabled={pending}
			onchange={(e) => pick(e.currentTarget.files?.[0])}
		/>
	</div>
	{#if message}<FormAlert {message} />{/if}
	{#if result}
		<div role="status" class="alert">
			<CircleCheck color="var(--c-green)" />
			<div>{result}</div>
		</div>
	{/if}

	{#if preview}
		{@const { plan } = preview}
		<div class="grid gap-4">
			{#if plan.missingKeys.length > 0}
				<div class="alert">
					<TriangleAlert color="var(--c-amber)" />
					<div class="grid gap-1">
						<p class="m-0">
							まだ存在しないプロジェクトがあります。このまま取り込むと、これらのプロジェクトには参加させません。
						</p>
						<p class="mono m-0 text-[0.8125rem]" data-testid="missing-keys">
							{plan.missingKeys.join('、')}
						</p>
					</div>
				</div>
			{/if}
			{#if plan.archivedKeys.length > 0}
				<div class="alert">
					<Archive class="text-muted-foreground" />
					<p class="m-0">
						アーカイブ済みのプロジェクトには参加させません: <span class="mono"
							>{plan.archivedKeys.join('、')}</span
						>
					</p>
				</div>
			{/if}

			<div
				class="grid-table preview"
				style="--cols: 72px minmax(104px, 0.9fr) minmax(176px, 1.2fr) 232px minmax(144px, 1fr) 152px"
			>
				<div role="table" aria-label="取り込む内容" style="min-width: 896px">
					<div role="row" class="grid-table-head">
						<span role="columnheader">取り込む</span>
						<span role="columnheader">名前</span>
						<span role="columnheader">メールアドレス</span>
						<span role="columnheader">ロール</span>
						<span role="columnheader">参加させるプロジェクト</span>
						<span role="columnheader">扱い</span>
					</div>
					{#each plan.rows as row (row.rowNumber)}
						{@const ok = importable(row)}
						{@const label = row.name || row.email}
						<div role="row" class={['row', { 'text-muted-foreground': !ok }]}>
							<span role="cell">
								<input
									type="checkbox"
									aria-label={`${label} を取り込む`}
									checked={ok && !unchecked[row.rowNumber]}
									disabled={!ok || pending}
									onchange={(e) => (unchecked[row.rowNumber] = !e.currentTarget.checked)}
								/>
							</span>
							<span role="cell" class="truncate font-medium">{row.name}</span>
							<span
								role="cell"
								class="truncate text-[0.8125rem] text-muted-foreground"
								title={row.email}>{row.email}</span
							>
							<span role="cell" class="flex items-center gap-2">
								{#if row.action === 'invite'}
									<select
										class="select w-28 shrink-0"
										aria-label={`${label} さんの招待ロール`}
										bind:value={roleOf[row.rowNumber]}
										disabled={pending}
									>
										{#each roles as value (value)}
											<option {value}>{ROLE_LABEL[value]}</option>
										{/each}
									</select>
									<span class="truncate text-xs text-muted-foreground">{row.backlogRole}</span>
								{:else if row.action === 'join'}
									<RolePill role={row.role} />
								{:else}
									<span class="truncate text-xs">{row.backlogRole}</span>
								{/if}
							</span>
							<span role="cell" class="text-[0.8125rem]">
								{(ok && row.projects.map((p) => p.name).join('、')) || '—'}
							</span>
							<span role="cell" class="text-[0.8125rem]">
								{#if row.reason}
									{SKIP_LABEL[row.reason]}
								{:else if !ok}
									{SKIP_LABEL.no_projects}
								{:else if row.action === 'invite'}
									招待
								{:else}
									参加を追加
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</div>

			{#if count > MAX_IMPORT_USERS}
				<FormAlert
					message={`一度に取り込めるのは${MAX_IMPORT_USERS}人までです。チェックを外して分けて取り込んでください（招待した人は次回の確認画面で「招待中」として除かれます）`}
				/>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					class="btn btn-primary"
					disabled={pending || count === 0 || count > MAX_IMPORT_USERS}
					onclick={run}>取り込む（{count} 人）</button
				>
				<button type="button" class="btn btn-outline" disabled={pending} onclick={close}
					>やめる</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	/* 1,000 行でも実行ボタンが遠くならないよう、表の中でスクロールする */
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
	.row input {
		accent-color: var(--primary);
	}
</style>
