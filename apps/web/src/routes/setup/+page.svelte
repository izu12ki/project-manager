<script lang="ts">
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>初期セットアップ</h1>
		<p>最初の管理者アカウントを作成します</p>
	</div>
	<form method="POST" use:enhance class="auth-form">
		{#if form?.message}<FormAlert message={form.message} />{/if}
		<div class="field">
			<label class="label" for="name">名前</label>
			<input class="input" id="name" name="name" required maxlength={50} />
		</div>
		<div class="field">
			<label class="label" for="email">メールアドレス</label>
			<input class="input" id="email" name="email" type="email" autocomplete="email" required />
		</div>
		<div class="field">
			<label class="label" for="password">パスワード</label>
			<PasswordInput
				id="password"
				name="password"
				autocomplete="new-password"
				required
				minlength={10}
				aria-describedby="password-hint"
			/>
			<p class="hint" id="password-hint">10文字以上</p>
		</div>
		<button type="submit" class="btn btn-primary">セットアップを完了</button>
	</form>
</div>
