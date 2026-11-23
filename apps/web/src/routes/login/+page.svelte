<script lang="ts">
	import { enhance, withPasswordKeys } from '#lib/forms.ts';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import PasswordSubmit from '#lib/components/PasswordSubmit.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="card auth-card">
	<div class="auth-head">
		<h1>ログイン</h1>
		<p>メールアドレスとパスワードを入力してください</p>
	</div>
	<!-- 移行期間: 旧形式のハッシュを照合できるよう、生のパスワードも送る（keepRaw） -->
	<form
		method="POST"
		use:enhance={withPasswordKeys({ fields: [{ name: 'password', keepRaw: true }] })}
		class="auth-form"
	>
		{#if form?.message}<FormAlert title="ログインできませんでした" message={form.message} />{/if}
		<div class="field">
			<label class="label" for="email">メールアドレス</label>
			<!-- value= だとハイドレーションで値を入れ直し、スクリプトの読み込み前に打った内容が消える -->
			<input
				class="input"
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				placeholder="you@example.com"
				required
				defaultValue={form?.email ?? ''}
			/>
		</div>
		<div class="field">
			<div class="flex items-center justify-between gap-2">
				<label class="label" for="password">パスワード</label>
				<a href="/forgot-password" class="link text-[0.8125rem]">パスワードをお忘れですか？</a>
			</div>
			<PasswordInput id="password" name="password" autocomplete="current-password" required />
		</div>
		<PasswordSubmit>ログイン</PasswordSubmit>
	</form>
</div>
