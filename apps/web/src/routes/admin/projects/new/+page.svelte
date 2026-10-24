<script lang="ts">
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<section class="grid w-full max-w-[640px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">新規プロジェクト</h1>
		<p class="page-desc">作成後に参加者を招待できます</p>
	</div>
	<form method="POST" use:enhance class="card">
		{#if form?.message}<FormAlert message={form.message} />{/if}
		<div class="field">
			<label class="label" for="key">キー</label>
			<input
				class="input mono uppercase"
				style="max-width: 200px"
				id="key"
				name="key"
				required
				pattern="[A-Za-z][A-Za-z0-9]*"
				minlength={2}
				maxlength={10}
				placeholder="WEB"
				aria-describedby="key-hint"
				aria-invalid={form?.fields?.key ? true : undefined}
			/>
			{#if form?.fields?.key}<p class="field-error">{form.fields.key[0]}</p>{/if}
			<p class="hint" id="key-hint">
				英字で始まる2〜10文字。課題番号の接頭辞になり、あとから変更できません。
			</p>
		</div>
		<div class="field">
			<label class="label" for="name">プロジェクト名</label>
			<input class="input" id="name" name="name" required maxlength={100} />
		</div>
		<div class="field">
			<label class="label" for="description">説明</label>
			<textarea class="textarea" id="description" name="description" rows="3"></textarea>
		</div>
		<div class="flex justify-end gap-2">
			<a href="/" class="btn btn-outline">キャンセル</a>
			<button type="submit" class="btn btn-primary">作成</button>
		</div>
	</form>
</section>
