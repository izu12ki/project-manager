<script lang="ts">
	import { enhance } from '$app/forms';
	import { CircleCheck } from '@lucide/svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>パスワードの再設定</h1>
		<p>登録済みのメールアドレスに再設定用のリンクを送ります</p>
	</div>
	<div class="auth-form">
		{#if form?.sent}
			<div role="status" class="alert">
				<CircleCheck color="var(--c-green)" />
				<div>
					登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールを確認してください。
				</div>
			</div>
		{:else}
			<form method="POST" use:enhance class="auth-form">
				{#if form?.message}<FormAlert message={form.message} />{/if}
				<div class="field">
					<label class="label" for="email">メールアドレス</label>
					<input class="input" id="email" name="email" type="email" autocomplete="email" required />
				</div>
				<button type="submit" class="btn btn-primary">再設定メールを送信</button>
			</form>
		{/if}
		<a href="/login" class="link text-center">ログインに戻る</a>
	</div>
</div>
