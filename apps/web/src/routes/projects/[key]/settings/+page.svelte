<script lang="ts">
	import { enhance } from '$app/forms';
	import { Archive, ArchiveRestore, Flag, Mail, Tag } from '@lucide/svelte';
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
</script>

<section class="grid w-full max-w-[800px] gap-6">
	{#if form?.message}<FormAlert message={form.message} />{/if}

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
						title={`${m.name} さんを外しますか？`}
						description="このプロジェクトの課題を閲覧できなくなり、担当している課題は未割当になります。"
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
							title="招待を取り消しますか？"
							description={`${inv.email} 宛ての招待リンクは無効になります。`}
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
						<Tag size={16} class="shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">{c.name}</span>
						{#if writable}
							<ConfirmAction
								action="?/deleteCategory"
								fields={{ id: c.id }}
								title={`カテゴリー「${c.name}」を削除しますか？`}
								description="このカテゴリーが設定されている課題は未設定になります。"
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
				リリースなどの節目です。削除すると、設定されていた課題は未設定になります
			</p>
		</div>
		{#if data.milestones.length > 0}
			<ul class="list">
				{#each data.milestones as m (m.id)}
					<li class="option-row">
						<Flag size={16} class="shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">{m.name}</span>
						<span class="text-[13px] text-muted-foreground tabular-nums"
							>{m.releaseDate ? `${m.releaseDate.replaceAll('-', '/')} リリース` : '日付なし'}</span
						>
						{#if writable}
							<ConfirmAction
								action="?/deleteMilestone"
								fields={{ id: m.id }}
								title={`マイルストーン「${m.name}」を削除しますか？`}
								description="このマイルストーンが設定されている課題は未設定になります。"
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
				title="プロジェクトをアーカイブしますか？"
				description={`「${data.project.name}」はアーカイブ済みに移動し、課題の追加・編集ができなくなります。`}
				confirmLabel="アーカイブする"
				destructive={false}
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
	.invite {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
</style>
