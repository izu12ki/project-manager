<script lang="ts">
	import { enhance } from '#lib/forms.ts';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import {
		PROJECT_KEY_INPUT_PATTERN,
		PROJECT_KEY_MAX,
		PROJECT_KEY_RULE
	} from '#lib/project-key.ts';
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
			<label class="label" for="name">プロジェクト名</label>
			<input
				class="input mono uppercase"
				style="max-width: 280px"
				id="name"
				name="name"
				required
				pattern={PROJECT_KEY_INPUT_PATTERN}
				minlength={2}
				maxlength={PROJECT_KEY_MAX}
				placeholder="WEB_APP"
				aria-describedby="name-hint"
				aria-invalid={form?.fields?.name ? true : undefined}
			/>
			{#if form?.fields?.name}<p class="field-error">{form.fields.name[0]}</p>{/if}
			<p class="hint" id="name-hint">
				{PROJECT_KEY_RULE}。そのままキー（課題番号の接頭辞）になります。名前とキーはあとから設定画面で別々に変えられます。
			</p>
		</div>
		<div class="flex justify-end gap-2">
			<a href="/" class="btn btn-outline">キャンセル</a>
			<button type="submit" class="btn btn-primary">作成</button>
		</div>
	</form>
</section>
