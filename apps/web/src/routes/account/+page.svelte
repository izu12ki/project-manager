<script lang="ts">
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

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
</script>

<section class="grid w-full max-w-[640px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">アカウント</h1>
		<p class="page-desc">{data.user?.email}</p>
	</div>

	{#if form?.message && !(form && 'slack' in form)}<FormAlert message={form.message} />{/if}

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
</section>
