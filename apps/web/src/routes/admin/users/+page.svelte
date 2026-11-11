<script lang="ts">
	import { enhance } from '#lib/forms.ts';
	import { Mail } from '@lucide/svelte';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import InviteLinkBox from '#lib/components/InviteLinkBox.svelte';
	import MultiSelect from '#lib/components/MultiSelect.svelte';
	import RolePill from '#lib/components/RolePill.svelte';
	import { formatDate, ROLE_LABEL } from '#lib/labels.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import BacklogUserImport from './BacklogUserImport.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const roles = ['admin', 'member', 'guest'] as const;

	// 変更確認中の行（select で選んだ値を保持する）
	let pendingChange = $state<{ id: string; name: string; role: (typeof roles)[number] } | null>(
		null
	);
	let roleDialog = $state<HTMLDialogElement>();
	let roleSelects: Record<string, HTMLSelectElement> = {};

	function requestRoleChange(u: { id: string; name: string }, select: HTMLSelectElement) {
		pendingChange = { id: u.id, name: u.name, role: select.value as (typeof roles)[number] };
		roleDialog?.showModal();
	}

	// キャンセル・確定のどちらでも閉じたら select を DB の値に戻す（確定後は再読込で新しい値になる）
	function resetRoleSelect() {
		if (!pendingChange) return;
		const { id } = pendingChange;
		const u = data.users.find((x) => x.id === id);
		const el = roleSelects[id];
		if (u && el) el.value = u.role;
		pendingChange = null;
	}
</script>

<section class="grid w-full max-w-[960px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">ユーザー</h1>
		<p class="page-desc">ワークスペースのユーザーと招待を管理します</p>
	</div>

	{#if form?.message}<FormAlert message={form.message} />{/if}

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">ユーザーを招待</h2>
			<p class="card-desc">招待メールのリンクから登録できます</p>
		</div>
		<form method="POST" action="?/invite" use:enhance class="grid gap-5">
			<div class="invite-grid">
				<div class="field">
					<label class="label" for="invite-email">メールアドレス</label>
					<input class="input" id="invite-email" name="email" type="email" required />
				</div>
				<div class="field">
					<label class="label" for="invite-role">ロール</label>
					<select class="select" id="invite-role" name="role">
						<option value="member">メンバー</option>
						<option value="guest">ゲスト</option>
						<option value="admin">{ROLE_LABEL.admin}</option>
					</select>
				</div>
				<div class="field">
					<span class="label" id="invite-project-label">参加プロジェクト</span>
					<MultiSelect
						id="invite-project"
						name="projectIds"
						options={data.projects.map((p) => ({ value: p.id, label: p.name }))}
						aria-describedby="invite-project-hint"
					/>
					<p class="hint" id="invite-project-hint">
						複数選択可。管理者は選ばなくても全プロジェクトを見られます
					</p>
				</div>
			</div>
			<div><button type="submit" class="btn btn-primary">招待する</button></div>
		</form>
		{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
	</div>

	<BacklogUserImport />

	<div class="card" style="padding: 0; gap: 0; overflow: hidden">
		<div style="padding: 20px 24px 12px"><h2 class="card-title">ユーザー一覧</h2></div>
		<div class="overflow-x-auto">
			<div
				role="table"
				aria-label="ユーザー一覧"
				class="users"
				style="--cols: minmax(220px, 1.4fr) minmax(200px, 1.2fr) 118px 80px 96px"
			>
				<div role="row" class="grid-table-head">
					<span role="columnheader">名前</span>
					<span role="columnheader">メール</span>
					<span role="columnheader">ロール</span>
					<span role="columnheader">状態</span>
					<span role="columnheader"><span class="sr-only">操作</span></span>
				</div>
				{#each data.users as u (u.id)}
					<div role="row" class:opacity-65={!!u.disabledAt}>
						<span role="cell" class="truncate font-medium">{u.name}</span>
						<span role="cell" class="truncate text-[0.8125rem] text-muted-foreground"
							>{u.email}</span
						>
						<span role="cell">
							{#if u.id === data.user?.id}
								<RolePill role={u.role} />
							{:else}
								<select
									class="select"
									aria-label={`${u.name} さんのロール`}
									value={u.role}
									bind:this={roleSelects[u.id]}
									onchange={(e) => requestRoleChange(u, e.currentTarget)}
								>
									{#each roles as value (value)}
										<option {value}>{ROLE_LABEL[value]}</option>
									{/each}
								</select>
							{/if}
						</span>
						<span role="cell">
							{#if u.disabledAt}
								<span class="pill pill-muted">無効</span>
							{:else}
								<span class="text-[0.8125rem] text-muted-foreground">有効</span>
							{/if}
						</span>
						<span role="cell" class="flex justify-end">
							{#if u.disabledAt}
								<form method="POST" action="?/enable" use:enhance>
									<input type="hidden" name="id" value={u.id} />
									<button type="submit" class="btn btn-outline btn-sm">有効化</button>
								</form>
							{:else if u.id !== data.user?.id}
								<ConfirmAction
									action="?/disable"
									fields={{ id: u.id }}
									title="ユーザーの無効化"
									description={`${u.name} さんを無効化してよろしいですか？\nすぐにログアウトされ、ログインできなくなります。`}
									confirmLabel="無効化する"
									triggerClass="btn btn-danger btn-sm"
								>
									{#snippet trigger()}無効化{/snippet}
								</ConfirmAction>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<ConfirmAction
		bind:dialog={roleDialog}
		action="?/changeRole"
		fields={{ id: pendingChange?.id ?? '', role: pendingChange?.role ?? '' }}
		title="ロールの変更"
		description={pendingChange
			? `${pendingChange.name}さんのロールを「${ROLE_LABEL[pendingChange.role]}」に変更します。このユーザーはログアウトされ、再ログインが必要になります。`
			: ''}
		confirmLabel="変更する"
		onclose={resetRoleSelect}
		onresult={(r) => {
			if (r.type === 'success')
				toast.success('ロールを変更しました。対象のユーザーはログアウトされました');
		}}
	/>

	<div class="card" style="gap: 12px; padding: 20px 24px">
		<h2 class="card-title">招待中</h2>
		{#if data.invitations.length === 0}
			<p class="m-0 text-muted-foreground">招待中のユーザーはいません</p>
		{:else}
			<div class="grid">
				{#each data.invitations as inv (inv.id)}
					<div class="invite">
						<Mail size={16} class="shrink-0 text-muted-foreground" />
						<span class="min-w-40 flex-1 truncate">{inv.email}</span>
						<RolePill role={inv.role} />
						{#if inv.projects.length > 0}<span class="text-[0.8125rem] text-muted-foreground"
								>{inv.projects.map((p) => p.name).join('、')}</span
							>{/if}
						{#if inv.expired}<span class="pill pill-urgent">期限切れ</span>{/if}
						<span class="text-xs text-muted-foreground tabular-nums"
							>期限 {formatDate(inv.expiresAt)}</span
						>
						<form method="POST" action="?/reissue" use:enhance>
							<input type="hidden" name="id" value={inv.id} />
							<button
								type="submit"
								class="btn btn-ghost btn-xs"
								title="再発行すると以前のリンクは無効になります">リンクを再発行</button
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
			</div>
		{/if}
	</div>
</section>

<style>
	.invite-grid {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 720px) {
		.invite-grid {
			grid-template-columns: minmax(0, 1fr) 160px 260px;
		}
	}
	.users {
		min-width: 720px;
	}
	.users [role='row'] {
		display: grid;
		grid-template-columns: var(--cols);
		align-items: center;
		min-height: 56px;
		padding: 0 16px;
		border-top: 1px solid var(--border);
	}
	.users .grid-table-head {
		min-height: 40px;
	}
	.users [role='cell'],
	.users [role='columnheader'] {
		padding: 0 8px;
		min-width: 0;
	}
	.invite {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 10px 0;
		border-top: 1px solid var(--border);
	}
</style>
