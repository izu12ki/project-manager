<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">パスワードの再設定</h1>
	{#if form?.sent}
		<p class="card text-sm">
			登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールを確認してください。
		</p>
	{:else}
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<label class="block">
				<span class="text-sm">メールアドレス</span>
				<input class="input" name="email" type="email" autocomplete="email" required />
			</label>
			<button class="btn-primary w-full">再設定リンクを送る</button>
		</form>
	{/if}
	<p class="mt-4 text-center text-sm">
		<a href="/login" class="text-blue-600 underline">ログインに戻る</a>
	</p>
</div>
