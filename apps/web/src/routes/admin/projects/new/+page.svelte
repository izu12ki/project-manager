<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">新規プロジェクト</h1>
<form method="POST" use:enhance class="card max-w-lg space-y-4">
	{#if form?.message}<p role="alert" class="text-sm text-red-600">{form.message}</p>{/if}
	<label class="block">
		<span class="text-sm"
			>キー（英字で始まる2〜10文字。課題番号の接頭辞になり、後から変更できません）</span
		>
		<input
			class="input uppercase"
			name="key"
			required
			pattern="[A-Za-z][A-Za-z0-9]*"
			minlength="2"
			maxlength="10"
		/>
		{#if form?.fields?.key}<span class="text-xs text-red-600">{form.fields.key[0]}</span>{/if}
	</label>
	<label class="block">
		<span class="text-sm">プロジェクト名</span>
		<input class="input" name="name" required maxlength="100" />
	</label>
	<label class="block">
		<span class="text-sm">説明（Markdown）</span>
		<textarea class="input" name="description" rows="4"></textarea>
	</label>
	<button class="btn-primary">作成</button>
</form>
