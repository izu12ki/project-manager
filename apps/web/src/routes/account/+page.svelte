<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">アカウント</h1>
{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<div class="grid gap-6 md:grid-cols-2">
	<form method="POST" action="?/updateName" use:enhance class="card space-y-4">
		<h2 class="font-semibold">表示名</h2>
		<label class="block">
			<span class="text-sm">名前</span>
			<input class="input" name="name" required maxlength="50" value={data.user?.name} />
		</label>
		<button class="btn-primary">保存</button>
		{#if form?.nameSaved}<p class="text-sm text-green-700">保存しました</p>{/if}
	</form>

	<form method="POST" action="?/changePassword" use:enhance class="card space-y-4">
		<h2 class="font-semibold">パスワード変更</h2>
		<label class="block">
			<span class="text-sm">現在のパスワード</span>
			<input
				class="input"
				name="currentPassword"
				type="password"
				autocomplete="current-password"
				required
			/>
		</label>
		<label class="block">
			<span class="text-sm">新しいパスワード（10文字以上）</span>
			<input
				class="input"
				name="newPassword"
				type="password"
				autocomplete="new-password"
				required
				minlength="10"
			/>
		</label>
		<button class="btn-primary">変更</button>
		{#if form?.passwordSaved}<p class="text-sm text-green-700">
				変更しました。他の端末はログアウトされます
			</p>{/if}
	</form>
</div>
