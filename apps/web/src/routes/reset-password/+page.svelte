<script lang="ts">
	import { enhance } from '$lib/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>新しいパスワード</h1>
		<p>10文字以上で設定してください</p>
	</div>
	{#if data.invalid || !data.token}
		<div role="alert" class="alert alert-destructive" style="grid-template-columns: 1fr">
			<div>
				リンクが無効か期限切れです。<a href="/forgot-password" class="underline"
					>もう一度やり直してください</a
				>。
			</div>
		</div>
	{:else}
		<form method="POST" use:enhance class="auth-form">
			{#if form?.message}<FormAlert message={form.message} />{/if}
			<input type="hidden" name="token" value={data.token} />
			<div class="field">
				<label class="label" for="password">パスワード</label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					required
					minlength={10}
				/>
			</div>
			<button type="submit" class="btn btn-primary">パスワードを再設定</button>
		</form>
	{/if}
</div>
