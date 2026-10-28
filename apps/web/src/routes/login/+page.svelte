<script lang="ts">
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>ログイン</h1>
		<p>メールアドレスとパスワードを入力してください</p>
	</div>
	<form method="POST" use:enhance class="auth-form">
		{#if form?.message}<FormAlert title="ログインできませんでした" message={form.message} />{/if}
		<div class="field">
			<label class="label" for="email">メールアドレス</label>
			<input
				class="input"
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				placeholder="you@example.com"
				required
				value={form?.email ?? ''}
			/>
		</div>
		<div class="field">
			<div class="flex items-center justify-between gap-2">
				<label class="label" for="password">パスワード</label>
				<a href="/forgot-password" class="link text-[0.8125rem]">パスワードをお忘れですか？</a>
			</div>
			<PasswordInput id="password" name="password" autocomplete="current-password" required />
		</div>
		<button type="submit" class="btn btn-primary">ログイン</button>
	</form>
</div>
