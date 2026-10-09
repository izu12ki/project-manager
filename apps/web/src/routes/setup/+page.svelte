<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-2 text-2xl font-bold">初期セットアップ</h1>
	<p class="mb-6 text-sm text-gray-600">最初の管理者アカウントを作成します。</p>
	<form method="POST" use:enhance class="card space-y-4">
		{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
		<label class="block">
			<span class="text-sm">名前</span>
			<input class="input" name="name" required maxlength="50" />
		</label>
		<label class="block">
			<span class="text-sm">メールアドレス</span>
			<input class="input" name="email" type="email" autocomplete="email" required />
		</label>
		<label class="block">
			<span class="text-sm">パスワード（10文字以上）</span>
			<input
				class="input"
				name="password"
				type="password"
				autocomplete="new-password"
				required
				minlength="10"
			/>
		</label>
		<button class="btn-primary w-full">セットアップを完了</button>
	</form>
</div>
