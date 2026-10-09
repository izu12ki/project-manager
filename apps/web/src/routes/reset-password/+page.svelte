<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">新しいパスワード</h1>
	{#if data.invalid || !data.token}
		<p class="card text-sm">
			リンクが無効か期限切れです。<a href="/forgot-password" class="text-blue-600 underline"
				>もう一度やり直してください</a
			>。
		</p>
	{:else}
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<input type="hidden" name="token" value={data.token} />
			<label class="block">
				<span class="text-sm">新しいパスワード（10文字以上）</span>
				<input
					class="input"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength="10"
				/>
			</label>
			<button class="btn-primary w-full">パスワードを変更</button>
		</form>
	{/if}
</div>
