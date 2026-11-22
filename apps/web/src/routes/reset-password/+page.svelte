<script lang="ts">
	import { enhance, withPasswordKeys } from '#lib/forms.ts';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import PasswordSubmit from '#lib/components/PasswordSubmit.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>新しいパスワード</h1>
		<p>10文字以上で設定してください</p>
	</div>
	{#if !data.email}
		<div role="alert" class="alert alert-destructive" style="grid-template-columns: 1fr">
			<div>
				リンクが無効か期限切れです。<a href="/forgot-password" class="underline">
					もう一度やり直してください
				</a>。
			</div>
		</div>
	{:else}
		<form
			method="POST"
			use:enhance={withPasswordKeys({ email: data.email, fields: [{ name: 'password' }] })}
			class="auth-form"
		>
			{#if form?.message}<FormAlert message={form.message} />{/if}
			<input type="hidden" name="token" value={data.token} />
			<!-- どのアカウントのパスワードかを見せる（パスワードマネージャーの保存先にもなる） -->
			<div class="field">
				<label class="label" for="email">メールアドレス</label>
				<input
					class="input"
					id="email"
					type="email"
					autocomplete="username"
					readonly
					value={data.email}
				/>
			</div>
			<div class="field">
				<label class="label" for="password">パスワード</label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					required
					minlength={10}
					maxlength={128}
				/>
			</div>
			<PasswordSubmit>パスワードを再設定</PasswordSubmit>
		</form>
	{/if}
</div>
