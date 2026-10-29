<script lang="ts">
	import { enhance } from '$lib/forms';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import { MAX_CUSTOM_EMOJI_NAME, normalizeEmojiName } from '$lib/custom-emoji';
	import { formatDate } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let name = $state('');
	let preview = $state<string | null>(null);
	let filter = $state('');

	$effect(() => {
		if (form?.added) toast.success(`:${form.added}: を追加しました`);
	});

	// 名前が空なら、ファイル名（拡張子を除く）を候補にする
	function pick(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
		if (file && name.trim() === '')
			name = normalizeEmojiName(file.name.replace(/\.[^.]*$/, '')).replace(
				/[^\p{L}\p{M}\p{N}_-]/gu,
				'_'
			);
	}

	const shown = $derived(data.emojis.filter((e) => e.name.includes(normalizeEmojiName(filter))));
</script>

<section class="grid w-full max-w-[720px] gap-6">
	<div class="grid gap-1">
		<h1 class="page-title">カスタム絵文字</h1>
		<p class="page-desc">
			コメントのリアクションに使える絵文字です。登録した絵文字はワークスペースの全員が使えます
		</p>
	</div>

	{#if data.canCreate}
		<div class="card">
			<div class="card-head">
				<h2 class="card-title">絵文字を追加</h2>
				<p class="card-desc">
					PNG・JPEG・GIF・WebP（256KB 以下）。正方形の画像がきれいに表示されます
				</p>
			</div>
			{#if form?.message}<FormAlert message={form.message} />{/if}
			<form
				method="POST"
				action="?/add"
				enctype="multipart/form-data"
				class="grid gap-4"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success') {
							name = '';
							if (preview) URL.revokeObjectURL(preview);
							preview = null;
						}
					}}
			>
				<div class="add-grid">
					<div class="field">
						<label class="label" for="emoji-image">画像</label>
						<input
							class="input"
							id="emoji-image"
							name="image"
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							required
							onchange={pick}
						/>
					</div>
					<div class="field">
						<label class="label" for="emoji-name">名前</label>
						<div class="name-input">
							<span aria-hidden="true">:</span>
							<input
								class="input"
								id="emoji-name"
								name="name"
								required
								maxlength={MAX_CUSTOM_EMOJI_NAME}
								placeholder="例: 承認"
								autocomplete="off"
								aria-describedby="emoji-name-hint"
								bind:value={name}
							/>
							<span aria-hidden="true">:</span>
						</div>
						<p class="hint" id="emoji-name-hint">文字・数字・_・- が使えます</p>
					</div>
					<div class="preview" aria-hidden="true">
						{#if preview}<img src={preview} alt="" />{/if}
					</div>
				</div>
				<div><button type="submit" class="btn btn-primary">追加する</button></div>
			</form>
		</div>
	{/if}

	<div class="card" style="gap: 12px">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="card-title">登録済み（{data.emojis.length}）</h2>
			{#if data.emojis.length > 0}
				<input
					class="input search"
					type="search"
					placeholder="名前で絞り込み"
					aria-label="名前で絞り込み"
					bind:value={filter}
				/>
			{/if}
		</div>
		{#if data.emojis.length === 0}
			<p class="m-0 text-muted-foreground">カスタム絵文字はまだありません</p>
		{:else}
			<ul class="list" aria-label="カスタム絵文字一覧">
				{#each shown as e (e.id)}
					<li>
						<img src={e.url} alt={`:${e.name}:`} class="emoji" loading="lazy" />
						<span class="min-w-0 flex-1 truncate font-medium">:{e.name}:</span>
						<span class="text-xs text-muted-foreground">
							{e.creatorName} ・ {formatDate(e.createdAt)}
						</span>
						{#if e.canDelete}
							<ConfirmAction
								action="?/delete"
								fields={{ id: e.id }}
								title="カスタム絵文字の削除"
								description={`:${e.name}: を削除します。\nこの絵文字で付けたリアクションも消えます。`}
								confirmLabel="削除する"
								triggerClass="btn btn-danger btn-sm"
								triggerLabel={`:${e.name}: を削除`}
							>
								{#snippet trigger()}削除{/snippet}
							</ConfirmAction>
						{/if}
					</li>
				{:else}
					<li class="text-muted-foreground">該当する絵文字はありません</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.add-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px;
		align-items: start;
		gap: 16px;
	}
	@media (max-width: 639px) {
		.add-grid {
			grid-template-columns: minmax(0, 1fr) 56px;
		}
		.add-grid > :first-child {
			grid-column: 1 / -1;
		}
	}
	.name-input {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--muted-foreground);
	}
	.preview {
		width: 56px;
		height: 56px;
		margin-top: 22px;
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
		display: grid;
		place-items: center;
	}
	.preview img {
		width: 32px;
		height: 32px;
		object-fit: contain;
	}
	.search {
		width: 14rem;
		max-width: 100%;
	}
	.list {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 2.75rem;
		padding: 4px 0;
		border-top: 1px solid var(--border);
		font-size: 0.875rem;
	}
	.list li:first-child {
		border-top: none;
	}
	.emoji {
		width: 28px;
		height: 28px;
		object-fit: contain;
		flex-shrink: 0;
	}
</style>
