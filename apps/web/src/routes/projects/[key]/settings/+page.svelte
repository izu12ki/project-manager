<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import {
		Archive,
		ArchiveRestore,
		ChevronDown,
		ChevronUp,
		CircleCheck,
		Flag,
		Mail,
		Pencil,
		RotateCcw,
		Tag
	} from '@lucide/svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import RolePill from '$lib/components/RolePill.svelte';
	import {
		FIXED_STATUSES,
		ROLE_LABEL,
		colorFor,
		colorVar,
		projectColor,
		projectIcon
	} from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const writable = $derived(!data.project.archivedAt);
	// アイコン・色・キーの変更をその場でプレビューする
	let icon = $derived(data.project.icon ?? '');
	let color = $derived(data.project.color ?? '');
	let key = $derived(data.project.key);

	$effect(() => {
		if (form?.saved) toast.success('保存しました');
	});

	/** 編集フォームを保存できたら、開いていた details を閉じる */
	const closeOnSuccess: SubmitFunction =
		({ formElement }) =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') formElement.closest('details')?.removeAttribute('open');
		};
</script>

<section class="grid w-full max-w-[800px] gap-6">
	{#if form?.message && !form.fields?.url}<FormAlert message={form.message} />{/if}

	<form
		method="POST"
		action="?/update"
		class="card"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<div class="card-head">
			<h2 class="card-title">基本情報</h2>
			<p class="card-desc">プロジェクト名・キー・アイコン・色・説明を変更します</p>
		</div>
		<div class="flex flex-wrap items-end gap-4">
			<span
				class="avatar avatar-square"
				style="--size: 40px; font-size: 18px"
				style:--c={projectColor({ key: key || 'A', color: color || null })}
				aria-hidden="true">{projectIcon({ key: key || '?', icon: icon || null })}</span
			>
			<div class="field">
				<label class="label" for="project-icon">アイコン</label>
				<input
					class="input"
					style="width: 120px"
					id="project-icon"
					name="icon"
					maxlength={16}
					placeholder={key[0] ?? ''}
					aria-describedby="project-icon-hint"
					bind:value={icon}
				/>
			</div>
			<p class="hint pb-2" id="project-icon-hint">絵文字や2文字までの文字。空欄ならキーの頭文字</p>
		</div>
		<div class="field">
			<span class="label">色</span>
			<ColorPicker
				name="color"
				value={data.project.color ?? ''}
				allowAuto
				label="色"
				onchange={(v) => (color = v)}
			/>
		</div>
		<div class="field">
			<label class="label" for="project-key">キー</label>
			<input
				class="input mono"
				style="width: 200px"
				id="project-key"
				name="key"
				required
				maxlength={10}
				aria-describedby="project-key-hint"
				bind:value={key}
			/>
			<p class="hint" id="project-key-hint">
				英字で始まる2〜10文字の英数字。変更すると URL と課題キー（{key.toUpperCase() ||
					data.project.key}-1 など）も変わります
			</p>
		</div>
		<div class="field">
			<label class="label" for="project-name">プロジェクト名</label>
			<input
				class="input"
				id="project-name"
				name="name"
				required
				maxlength={100}
				value={data.project.name}
			/>
		</div>
		<div class="field">
			<label class="label" for="project-description">説明</label>
			<textarea
				class="textarea"
				id="project-description"
				name="description"
				rows="3"
				value={data.project.description}></textarea>
		</div>
		<div><button type="submit" class="btn btn-primary">保存</button></div>
	</form>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">参加者</h2>
			<p class="card-desc">
				{data.members.length} 名が参加しています。管理者は全プロジェクトに参加しています。
			</p>
		</div>
		<ul class="list">
			{#each data.members as m (m.id)}
				<li class="member">
					<span class="avatar" style:--c={colorFor(m.name)}>{m.name[0]}</span>
					<div class="grid min-w-0" style="line-height: 1.3">
						<span class="font-medium">{m.name}</span>
						<span class="truncate text-[13px] text-muted-foreground">{m.email}</span>
					</div>
					<RolePill role={m.role} />
					<ConfirmAction
						action="?/removeMember"
						fields={{ id: m.id }}
						title="参加者の削除"
						description={`${m.name} さんをこのプロジェクトから外してよろしいですか？\n担当している課題は未割当になります。`}
						confirmLabel="外す"
					>
						{#snippet trigger()}外す{/snippet}
					</ConfirmAction>
				</li>
			{/each}
		</ul>
		{#if data.candidates.length > 0}
			<form
				method="POST"
				action="?/addMember"
				use:enhance
				class="grid items-end gap-3"
				style="grid-template-columns: minmax(0, 1fr) auto"
			>
				<div class="field">
					<label class="label" for="add-member">追加するユーザー</label>
					<select class="select" id="add-member" name="id">
						{#each data.candidates as u (u.id)}
							<option value={u.id}>{u.name}（{ROLE_LABEL[u.role]}）</option>
						{/each}
					</select>
				</div>
				<button type="submit" class="btn btn-outline">追加</button>
			</form>
		{/if}
	</div>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">ゲスト</h2>
			<p class="card-desc">
				ゲストはこのプロジェクトの課題の閲覧・作成・編集とコメントができます（課題の削除はできません）
			</p>
		</div>
		<form
			method="POST"
			action="?/inviteGuest"
			use:enhance
			class="grid items-end gap-3"
			style="grid-template-columns: minmax(0, 1fr) auto"
		>
			<div class="field">
				<label class="label" for="guest-email">ゲストのメールアドレス</label>
				<input class="input" id="guest-email" name="email" type="email" required />
			</div>
			<button type="submit" class="btn btn-outline">ゲストを招待</button>
		</form>
		{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
		{#if data.invitations.length > 0}
			<div class="grid">
				<div class="pb-1 text-[13px] font-medium text-muted-foreground">招待中</div>
				{#each data.invitations as inv (inv.id)}
					<div class="invite">
						<Mail size={16} class="shrink-0 text-muted-foreground" />
						<span class="min-w-40 flex-1 truncate">{inv.email}</span>
						{#if inv.expired}<span class="pill pill-urgent">期限切れ</span>{/if}
						<form method="POST" action="?/reissue" use:enhance>
							<input type="hidden" name="id" value={inv.id} />
							<button
								type="submit"
								class="btn btn-ghost btn-xs"
								title="コピーすると招待を再発行し、以前のリンクは無効になります"
								>リンクを再発行</button
							>
						</form>
						<ConfirmAction
							action="?/revoke"
							fields={{ id: inv.id }}
							title="招待の取り消し"
							description={`${inv.email} 宛ての招待を取り消してよろしいですか？\n招待リンクは無効になります。`}
							confirmLabel="取り消す"
							triggerClass="btn btn-ghost btn-xs"
						>
							{#snippet trigger()}取り消し{/snippet}
						</ConfirmAction>
					</div>
				{/each}
				<p class="hint pt-2">再発行すると以前のリンクは無効になります</p>
			</div>
		{/if}
	</div>

	{#snippet moveButtons(action: string, id: string, i: number, total: number, name: string)}
		<form method="POST" {action} use:enhance class="row-meta flex">
			<input type="hidden" name="id" value={id} />
			<button
				type="submit"
				name="dir"
				value="up"
				class="icon-btn"
				disabled={i === 0}
				aria-label={`${name} を上へ`}
				title="上へ"><ChevronUp /></button
			>
			<button
				type="submit"
				name="dir"
				value="down"
				class="icon-btn"
				disabled={i === total - 1}
				aria-label={`${name} を下へ`}
				title="下へ"><ChevronDown /></button
			>
		</form>
	{/snippet}

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">課題種別</h2>
			<p class="card-desc">
				課題の種類です。課題の作成・詳細画面でタイトルの上から選べます。削除すると、設定されていた課題は未設定になります
			</p>
		</div>
		{#if data.issueTypes.length > 0}
			<ul class="list">
				{#each data.issueTypes as t, i (t.id)}
					<li class="option-row">
						<span class="dot row-icon" style:--c={colorVar(t.color)}></span>
						{#if writable}
							<details class="edit">
								<summary>
									<span class="truncate">{t.name}</span>
									<Pencil size={14} class="shrink-0 text-muted-foreground" />
									<span class="sr-only">を編集</span>
								</summary>
								<form
									method="POST"
									action="?/updateIssueType"
									use:enhance={closeOnSuccess}
									class="edit-form"
								>
									<input type="hidden" name="id" value={t.id} />
									<div class="grid gap-2" style="grid-template-columns: minmax(0, 1fr) auto">
										<input
											class="input"
											name="name"
											aria-label={`${t.name} の名称`}
											required
											maxlength={50}
											value={t.name}
										/>
										<button type="submit" class="btn btn-outline">保存</button>
									</div>
									<ColorPicker name="color" value={t.color} label={`${t.name} の色`} />
								</form>
							</details>
							{@render moveButtons('?/moveIssueType', t.id, i, data.issueTypes.length, t.name)}
							<ConfirmAction
								action="?/deleteIssueType"
								fields={{ id: t.id }}
								title="課題種別の削除"
								description={`課題種別「${t.name}」を削除してよろしいですか？\n設定されている課題は未設定になります。`}
								confirmLabel="削除する"
								triggerClass="btn btn-ghost btn-xs"
							>
								{#snippet trigger()}削除{/snippet}
							</ConfirmAction>
						{:else}
							<span class="min-w-0 flex-1 truncate">{t.name}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if writable}
			<form method="POST" action="?/addIssueType" use:enhance class="grid gap-3">
				<div class="grid items-end gap-3" style="grid-template-columns: minmax(0, 1fr) auto">
					<div class="field">
						<label class="label" for="issue-type-name">課題種別名</label>
						<input
							class="input"
							id="issue-type-name"
							name="name"
							required
							maxlength={50}
							placeholder="例: 調査"
						/>
					</div>
					<button type="submit" class="btn btn-outline">追加</button>
				</div>
				<ColorPicker name="color" label="追加する課題種別の色" />
			</form>
		{/if}
	</div>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">ステータス</h2>
			<p class="card-desc">
				課題の進み具合です。並び順はボードの列の順になります。「未着手」と「完了」は削除できません。削除すると、そのステータスの課題は「未着手」になります
			</p>
		</div>
		<ul class="list">
			{#each data.statuses as st, i (st.key)}
				<li class="option-row">
					<span class="dot row-icon" style:--c={colorVar(st.color)}></span>
					{#if writable}
						<details class="edit">
							<summary>
								<span class="truncate">{st.name}</span>
								<Pencil size={14} class="shrink-0 text-muted-foreground" />
								<span class="sr-only">を編集</span>
							</summary>
							<form
								method="POST"
								action="?/updateStatus"
								use:enhance={closeOnSuccess}
								class="edit-form"
							>
								<input type="hidden" name="id" value={st.key} />
								<div class="grid gap-2" style="grid-template-columns: minmax(0, 1fr) auto">
									<input
										class="input"
										name="name"
										aria-label={`${st.name} の名称`}
										required
										maxlength={50}
										value={st.name}
									/>
									<button type="submit" class="btn btn-outline">保存</button>
								</div>
								<ColorPicker name="color" value={st.color} label={`${st.name} の色`} />
							</form>
						</details>
						{@render moveButtons('?/moveStatus', st.key, i, data.statuses.length, st.name)}
						{#if FIXED_STATUSES.includes(st.key)}
							<span class="row-meta w-[52px] text-center text-xs text-muted-foreground">既定</span>
						{:else}
							<ConfirmAction
								action="?/deleteStatus"
								fields={{ id: st.key }}
								title="ステータスの削除"
								description={`ステータス「${st.name}」を削除してよろしいですか？\nこのステータスの課題は「未着手」になります。`}
								confirmLabel="削除する"
								triggerClass="btn btn-ghost btn-xs"
							>
								{#snippet trigger()}削除{/snippet}
							</ConfirmAction>
						{/if}
					{:else}
						<span class="min-w-0 flex-1 truncate">{st.name}</span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if writable}
			<form method="POST" action="?/addStatus" use:enhance class="grid gap-3">
				<div class="grid items-end gap-3" style="grid-template-columns: minmax(0, 1fr) auto">
					<div class="field">
						<label class="label" for="status-name">ステータス名</label>
						<input
							class="input"
							id="status-name"
							name="name"
							required
							maxlength={50}
							placeholder="例: 保留"
						/>
					</div>
					<button type="submit" class="btn btn-outline">追加</button>
				</div>
				<ColorPicker name="color" label="追加するステータスの色" />
			</form>
		{/if}
	</div>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">カテゴリー</h2>
			<p class="card-desc">
				課題を分類する項目です。削除すると、設定されていた課題は未設定になります
			</p>
		</div>
		{#if data.categories.length > 0}
			<ul class="list">
				{#each data.categories as c (c.id)}
					<li class="option-row">
						<Tag size={16} class="row-icon shrink-0 text-muted-foreground" />
						{#if writable}
							<details class="edit">
								<summary>
									<span class="truncate">{c.name}</span>
									<Pencil size={14} class="shrink-0 text-muted-foreground" />
									<span class="sr-only">を編集</span>
								</summary>
								<form
									method="POST"
									action="?/updateCategory"
									use:enhance={closeOnSuccess}
									class="edit-form"
									style="grid-template-columns: minmax(0, 1fr) auto"
								>
									<input type="hidden" name="id" value={c.id} />
									<input
										class="input"
										name="name"
										aria-label={`${c.name} の名称`}
										required
										maxlength={50}
										value={c.name}
									/>
									<button type="submit" class="btn btn-outline">保存</button>
								</form>
							</details>
						{:else}
							<span class="min-w-0 flex-1 truncate">{c.name}</span>
						{/if}
						{#if writable}
							<ConfirmAction
								action="?/deleteCategory"
								fields={{ id: c.id }}
								title="カテゴリーの削除"
								description={`カテゴリー「${c.name}」を削除してよろしいですか？\n設定されている課題は未設定になります。`}
								confirmLabel="削除する"
								triggerClass="btn btn-ghost btn-xs"
							>
								{#snippet trigger()}削除{/snippet}
							</ConfirmAction>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if writable}
			<form
				method="POST"
				action="?/addCategory"
				use:enhance
				class="grid items-end gap-3"
				style="grid-template-columns: minmax(0, 1fr) auto"
			>
				<div class="field">
					<label class="label" for="category-name">カテゴリー名</label>
					<input
						class="input"
						id="category-name"
						name="name"
						required
						maxlength={50}
						placeholder="例: フロントエンド"
					/>
				</div>
				<button type="submit" class="btn btn-outline">追加</button>
			</form>
		{/if}
	</div>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">マイルストーン</h2>
			<p class="card-desc">
				リリースなどの節目です。完了にすると課題の選択肢から外れます。削除すると、設定されていた課題は未設定になります
			</p>
		</div>
		{#if data.milestones.length > 0}
			<ul class="list">
				{#each data.milestones as m (m.id)}
					<li class="option-row">
						{#if m.completedAt}
							<CircleCheck size={16} class="row-icon shrink-0" style="color: var(--c-green)" />
						{:else}
							<Flag size={16} class="row-icon shrink-0 text-muted-foreground" />
						{/if}
						{#if writable}
							<details class="edit">
								<summary>
									<span class="truncate" class:text-muted-foreground={m.completedAt}>{m.name}</span>
									<Pencil size={14} class="shrink-0 text-muted-foreground" />
									<span class="sr-only">を編集</span>
								</summary>
								<form
									method="POST"
									action="?/updateMilestone"
									use:enhance={closeOnSuccess}
									class="edit-form"
									style="grid-template-columns: minmax(0, 1fr) 160px auto"
								>
									<input type="hidden" name="id" value={m.id} />
									<input
										class="input"
										name="name"
										aria-label={`${m.name} の名称`}
										required
										maxlength={50}
										value={m.name}
									/>
									<input
										class="input"
										name="releaseDate"
										type="date"
										aria-label={`${m.name} の予定日`}
										value={m.releaseDate ?? ''}
									/>
									<button type="submit" class="btn btn-outline">保存</button>
								</form>
							</details>
						{:else}
							<span class="min-w-0 flex-1 truncate" class:text-muted-foreground={m.completedAt}
								>{m.name}</span
							>
						{/if}
						<span class="row-meta text-[13px] text-muted-foreground tabular-nums"
							>{m.completedAt ? '完了 · ' : ''}{m.releaseDate
								? `${m.releaseDate.replaceAll('-', '/')} リリース`
								: '日付なし'}</span
						>
						{#if writable}
							<form method="POST" action="?/completeMilestone" use:enhance class="row-meta">
								<input type="hidden" name="id" value={m.id} />
								<input type="hidden" name="completed" value={String(!m.completedAt)} />
								<button type="submit" class="btn btn-ghost btn-xs">
									{#if m.completedAt}<RotateCcw />未完了に戻す{:else}<CircleCheck />完了にする{/if}
								</button>
							</form>
							<ConfirmAction
								action="?/deleteMilestone"
								fields={{ id: m.id }}
								title="マイルストーンの削除"
								description={`マイルストーン「${m.name}」を削除してよろしいですか？\n設定されている課題は未設定になります。`}
								confirmLabel="削除する"
								triggerClass="btn btn-ghost btn-xs"
							>
								{#snippet trigger()}削除{/snippet}
							</ConfirmAction>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if writable}
			<form
				method="POST"
				action="?/addMilestone"
				use:enhance
				class="grid items-end gap-3"
				style="grid-template-columns: minmax(0, 1fr) 160px auto"
			>
				<div class="field">
					<label class="label" for="milestone-name">マイルストーン名</label>
					<input
						class="input"
						id="milestone-name"
						name="name"
						required
						maxlength={50}
						placeholder="例: v1.0"
					/>
				</div>
				<div class="field">
					<label class="label" for="milestone-date">リリース日</label>
					<input class="input" id="milestone-date" name="releaseDate" type="date" />
				</div>
				<button type="submit" class="btn btn-outline">追加</button>
			</form>
		{/if}
	</div>

	<div
		class="card flex-row flex-wrap items-center justify-between gap-4"
		style="padding: 20px 24px"
	>
		<div class="grid gap-1">
			<h2 class="card-title">アーカイブ</h2>
			<p class="card-desc">
				{data.project.archivedAt
					? 'アーカイブを解除すると課題の追加・編集ができるようになります'
					: '一覧の「アーカイブ済み」に移動し、課題は閲覧のみになります'}
			</p>
		</div>
		{#if data.project.archivedAt}
			<form method="POST" action="?/archive" use:enhance>
				<input type="hidden" name="archived" value="false" />
				<button type="submit" class="btn btn-outline"><ArchiveRestore />アーカイブを解除</button>
			</form>
		{:else}
			<ConfirmAction
				action="?/archive"
				fields={{ archived: 'true' }}
				title="プロジェクトのアーカイブ"
				description={`「${data.project.name}」をアーカイブしてよろしいですか？\n課題の追加・編集ができなくなります。`}
				confirmLabel="アーカイブする"
				triggerClass="btn btn-outline"
			>
				{#snippet trigger()}<Archive />アーカイブする{/snippet}
			</ConfirmAction>
		{/if}
	</div>
</section>

<style>
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.member {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.option-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px 0;
		border-bottom: 1px solid var(--border);
	}
	.option-row:has(details[open]) {
		align-items: flex-start;
	}
	.option-row:has(details[open]) :global(.row-icon),
	.option-row:has(details[open]) .row-meta {
		margin-top: 10px;
	}
	.dot {
		flex-shrink: 0;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: var(--c);
	}
	.option-row:has(details[open]) .dot {
		margin-top: 13px;
	}
	.edit {
		flex: 1;
		min-width: 0;
	}
	.edit summary {
		display: flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		max-width: 100%;
		cursor: pointer;
		list-style: none;
		border-radius: 4px;
	}
	.edit summary::-webkit-details-marker {
		display: none;
	}
	.edit summary:hover {
		text-decoration: underline;
	}
	.edit summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.edit[open] summary {
		margin: 10px 0 8px;
	}
	.edit-form {
		display: grid;
		gap: 8px;
		padding-bottom: 8px;
	}
	.invite {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
</style>
