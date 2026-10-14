<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import {
		Archive,
		ArchiveRestore,
		CircleCheck,
		Flag,
		Mail,
		Pencil,
		RotateCcw,
		Tag,
		Webhook
	} from '@lucide/svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import RolePill from '$lib/components/RolePill.svelte';
	import { ROLE_LABEL, colorFor } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const writable = $derived(!data.project.archivedAt);

	$effect(() => {
		if (form?.saved) toast.success('保存しました');
	});

	$effect(() => {
		const r = form?.testResult;
		if (!r) return;
		if (r.ok) toast.success('テスト送信しました。チャンネルを確認してください');
		else toast.error(`テスト送信に失敗しました（${r.error}）`);
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
			<p class="card-desc">プロジェクト名と説明を変更します</p>
		</div>
		<div class="field">
			<label class="label" for="project-key">キー</label>
			<input
				class="input mono"
				style="width: 200px"
				id="project-key"
				readonly
				value={data.project.key}
			/>
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
			<p class="hint">Markdown が使えます</p>
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
			<p class="card-desc">ゲストはこのプロジェクトの閲覧とコメントのみ行えます</p>
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

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">外部連携</h2>
			<p class="card-desc">
				課題の作成・担当者の変更・ステータスの変更・コメントをチャットに投稿します
			</p>
		</div>
		<p class="hint m-0">
			課題のタイトルとコメントの抜粋がこのチャンネルに投稿されます。ゲストに見せたくない内容がある場合はチャンネルの参加者に注意してください。
		</p>
		{#if data.webhooks.length > 0}
			<ul class="list">
				{#each data.webhooks as w (w.id)}
					<li class="option-row">
						<Webhook size={16} class="row-icon shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate"
							>{w.providerLabel} <span class="text-muted-foreground">{w.maskedUrl}</span></span
						>
						<form
							method="POST"
							action="?/testWebhook"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
						>
							<input type="hidden" name="id" value={w.id} />
							<button type="submit" class="btn btn-ghost btn-xs">テスト送信</button>
						</form>
						<ConfirmAction
							action="?/removeWebhook"
							fields={{ id: w.id }}
							title="連携先の削除"
							description={`${w.providerLabel} への投稿を停止します。よろしいですか？`}
							confirmLabel="削除する"
							triggerClass="btn btn-ghost btn-xs"
						>
							{#snippet trigger()}削除{/snippet}
						</ConfirmAction>
					</li>
				{/each}
			</ul>
		{/if}
		<form
			method="POST"
			action="?/addWebhook"
			use:enhance
			class="grid items-end gap-3"
			style="grid-template-columns: auto minmax(0, 1fr) auto"
		>
			<div class="field">
				<label class="label" for="webhook-provider">連携先</label>
				<select class="input" id="webhook-provider" name="provider">
					{#each data.providerOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label class="label" for="webhook-url">Webhook URL</label>
				<input
					class="input"
					id="webhook-url"
					name="url"
					required
					placeholder="https://hooks.slack.com/services/..."
					aria-invalid={form?.fields?.url ? 'true' : undefined}
				/>
			</div>
			<button type="submit" class="btn btn-outline">追加</button>
		</form>
		{#if form?.fields?.url}<p class="field-error m-0">{form.fields.url[0]}</p>{/if}
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
