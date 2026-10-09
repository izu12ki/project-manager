<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	{#if !data.invitation}
		<h1 class="mb-4 text-2xl font-bold">招待リンクが無効です</h1>
		<p class="text-sm text-gray-600">
			招待リンクが無効か、期限切れです。管理者に再発行を依頼してください。
		</p>
	{:else}
		<h1 class="mb-2 text-2xl font-bold">アカウント登録</h1>
		<p class="mb-6 text-sm text-gray-600">
			{data.invitation.email} を{data.invitation
				.roleLabel}として登録します{#if data.invitation.projectName}（プロジェクト: {data.invitation
					.projectName}）{/if}。
		</p>
		<form method="POST" use:enhance class="card space-y-4">
			{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
			<label class="block">
				<span class="text-sm">名前</span>
				<input class="input" name="name" required maxlength="50" />
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
			<button class="btn-primary w-full">登録する</button>
		</form>
	{/if}
</div>
