<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { Check, Copy } from '@lucide/svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { FONT_SIZES, fontSize } from '$lib/font-size.svelte';
	import { formatDate, formatDateTime } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	onMount(() => fontSize.init());

	// 選択肢の見本「あ」は、今の設定に関係なく大きさの違いがわかるように見せる
	const SAMPLE_PX = { normal: 15, large: 18, xlarge: 21 } as const;

	$effect(() => {
		if (form?.nameSaved) toast.success('保存しました');
	});
	$effect(() => {
		if (form?.passwordSaved)
			toast.success('パスワードを変更しました。他の端末はログアウトされます');
	});
	$effect(() => {
		if (form?.slackEnabled)
			toast.success('Slack 通知をオンにしました。Slack に確認のメッセージを送りました。');
	});
	$effect(() => {
		if (form?.slackDisabled) toast.success('Slack 通知をオフにしました');
	});
	$effect(() => {
		if (form?.apiKeyRevoked) toast.success('API キーを無効化しました');
	});

	// 作成直後のトークン。画面を離れる（再読み込み・遷移）と消える
	let token = $derived(form && 'apiKeyToken' in form ? form.apiKeyToken : null);
	let copied = $state(false);
	async function copyToken() {
		if (!token) return;
		try {
			await navigator.clipboard.writeText(token);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// クリップボードが使えない環境では手動コピーに任せる
		}
	}
</script>

<section class="grid w-full max-w-[640px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">アカウント</h1>
		<p class="page-desc">{data.user?.email}</p>
	</div>

	{#if form?.message && !(form && ('slack' in form || 'apiKey' in form))}<FormAlert
			message={form.message}
		/>{/if}

	<form method="POST" action="?/updateName" use:enhance class="card">
		<div class="card-head">
			<h2 class="card-title">表示名</h2>
			<p class="card-desc">課題やコメントに表示される名前です</p>
		</div>
		<div class="field">
			<label class="label" for="account-name">名前</label>
			<input
				class="input"
				id="account-name"
				name="name"
				required
				maxlength={50}
				value={data.user?.name}
			/>
		</div>
		<div><button type="submit" class="btn btn-primary">保存</button></div>
	</form>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title" id="font-size-title">文字の大きさ</h2>
			<p class="card-desc">画面全体の文字を大きくします。この端末のブラウザに保存されます</p>
		</div>
		<div class="sizes" role="radiogroup" aria-labelledby="font-size-title">
			{#each FONT_SIZES as s (s.value)}
				<label class="size">
					<input
						type="radio"
						name="font-size"
						value={s.value}
						checked={fontSize.current === s.value}
						onchange={() => fontSize.set(s.value)}
					/>
					<span class="sample" style:font-size="{SAMPLE_PX[s.value]}px">あ</span>
					{s.label}
				</label>
			{/each}
		</div>
	</div>

	<form method="POST" action="?/changePassword" use:enhance class="card">
		<div class="card-head">
			<h2 class="card-title">パスワード変更</h2>
			<p class="card-desc">変更後は他の端末からログアウトされます</p>
		</div>
		<div class="grid gap-4">
			<div class="field">
				<label class="label" for="current-password">現在のパスワード</label>
				<PasswordInput
					id="current-password"
					name="currentPassword"
					autocomplete="current-password"
					required
				/>
			</div>
			<div class="field">
				<label class="label" for="new-password">新しいパスワード</label>
				<PasswordInput
					id="new-password"
					name="newPassword"
					autocomplete="new-password"
					required
					minlength={10}
					aria-describedby="new-password-hint"
				/>
				<p class="hint" id="new-password-hint">10文字以上</p>
			</div>
		</div>
		<div><button type="submit" class="btn btn-primary">保存</button></div>
	</form>

	<div class="card">
		<div class="card-head">
			<h2 class="card-title">Slack 通知</h2>
			<p class="card-desc">
				このアプリのログイン用メールアドレス（{data.user?.email}）と同じメールアドレスの Slack
				アカウントに、DM で通知が届きます。Slack
				のプロフィールのメールアドレスが異なる場合は届きません。
			</p>
		</div>
		{#if form && 'slack' in form && form.message}<FormAlert message={form.message} />{/if}
		<form
			method="POST"
			action={data.slack.linked ? '?/disableSlack' : '?/enableSlack'}
			use:enhance
			class="flex items-center gap-3"
		>
			<button
				type="submit"
				class="btn {data.slack.linked ? 'btn-outline' : 'btn-primary'}"
				role="switch"
				aria-checked={data.slack.linked}
				aria-label="Slack 通知"
				disabled={!data.slack.available && !data.slack.linked}
			>
				{data.slack.linked ? 'オフにする' : 'オンにする'}
			</button>
			<span class="text-sm text-muted-foreground">
				{#if data.slack.linked}Slack に連携中{:else if !data.slack.available}Slack
					連携は未設定です（管理者に連絡してください）{:else}オフ{/if}
			</span>
		</form>
	</div>

	{#if data.apiKeys}
		<div class="card">
			<div class="card-head">
				<h2 class="card-title">API キー</h2>
				<p class="card-desc">
					外部のツールから REST API を使うためのキーです。キーは作成した管理者本人として動作します。
				</p>
			</div>
			{#if form && 'apiKey' in form && form.message}<FormAlert message={form.message} />{/if}
			{#if token}
				<div class="field" role="status">
					<label class="label" for="api-key-token">新しい API キー</label>
					<div class="flex gap-2">
						<input
							class="input mono"
							id="api-key-token"
							data-testid="api-key-token"
							readonly
							value={token}
							onfocus={(e) => e.currentTarget.select()}
						/>
						<button type="button" class="btn btn-outline" onclick={copyToken}>
							{#if copied}<Check size={16} />コピーしました{:else}<Copy size={16} />コピー{/if}
						</button>
					</div>
					<p class="hint">この画面を離れると二度と表示されません。</p>
				</div>
			{/if}
			<form method="POST" action="?/createApiKey" use:enhance class="flex items-end gap-3">
				<div class="field flex-1">
					<label class="label" for="api-key-name">名前</label>
					<input
						class="input"
						id="api-key-name"
						name="name"
						required
						maxlength={50}
						placeholder="例: 集計スクリプト"
					/>
				</div>
				<button type="submit" class="btn btn-primary">作成</button>
			</form>
			{#if data.apiKeys.length}
				<ul class="grid gap-2" aria-label="API キー一覧">
					{#each data.apiKeys as key (key.id)}
						<li class="flex items-center justify-between gap-3 text-sm">
							<div class="grid min-w-0 gap-0.5">
								<span class="font-medium break-all">{key.name}</span>
								<span class="text-xs text-muted-foreground">
									<code>{key.prefix}…</code> ・ 作成 {formatDate(key.createdAt)} ・ 最終利用
									{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '未使用'}
								</span>
							</div>
							<ConfirmAction
								action="?/revokeApiKey"
								fields={{ id: key.id }}
								title="API キーの無効化"
								description={`「${key.name}」を無効化します。このキーを使っているツールは動かなくなります。`}
								confirmLabel="無効化する"
								triggerClass="btn btn-danger btn-sm"
								triggerLabel={`${key.name} を無効化`}
							>
								{#snippet trigger()}無効化{/snippet}
							</ConfirmAction>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted-foreground">API キーはまだありません。</p>
			{/if}
		</div>
	{/if}
</section>

<style>
	.sizes {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.size {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		position: relative;
		min-width: 6rem;
		height: 2.5rem;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
		cursor: pointer;
	}
	.size:hover {
		background: var(--accent);
	}
	.size:has(:checked) {
		border-color: var(--primary);
		background: var(--primary-soft);
		color: var(--primary-ink);
		font-weight: 700;
	}
	.size:has(:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.size input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.sample {
		width: 1.5em;
		text-align: center;
		font-weight: 700;
		line-height: 1;
	}
</style>
