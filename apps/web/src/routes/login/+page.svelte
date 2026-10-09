<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">ログイン</h1>
	<form method="POST" use:enhance class="card space-y-4">
		{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
		<label class="block">
			<span class="text-sm">メールアドレス</span>
			<input
				class="input"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>
		</label>
		<label class="block">
			<span class="text-sm">パスワード</span>
			<input
				class="input"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
		</label>
		<button class="btn-primary w-full">ログイン</button>
	</form>
	<p class="mt-4 text-center text-sm">
		<a href="/forgot-password" class="text-blue-600 underline">パスワードを忘れた場合</a>
	</p>
</div>
