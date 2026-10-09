<script lang="ts">
	import { enhance } from '$app/forms';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<div class="grid gap-6 md:grid-cols-2">
	<form
		method="POST"
		action="?/update"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="card space-y-4"
	>
		<h2 class="font-semibold">プロジェクト情報</h2>
		<label class="block text-sm">
			<span>プロジェクト名</span>
			<input class="input" name="name" required maxlength="100" value={data.project.name} />
		</label>
		<label class="block text-sm">
			<span>説明（Markdown）</span>
			<textarea class="input" name="description" rows="4" value={data.project.description}
			></textarea>
		</label>
		<button class="btn-primary">保存</button>
		{#if form?.saved}<span class="text-sm text-green-700">保存しました</span>{/if}
	</form>

	<section class="card space-y-4">
		<h2 class="font-semibold">ゲストを招待</h2>
		<form method="POST" action="?/inviteGuest" use:enhance class="flex items-end gap-2">
			<label class="block flex-1 text-sm">
				<span>ゲストのメールアドレス</span>
				<input class="input" name="email" type="email" required />
			</label>
			<button class="btn-primary">ゲストを招待</button>
		</form>
		{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
		{#each data.invitations as inv (inv.id)}
			<div class="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 text-sm">
				<span>{inv.email}</span>
				{#if inv.expired}<span class="text-red-600">期限切れ</span>{/if}
				<form method="POST" action="?/reissue" use:enhance class="ml-auto flex items-center gap-2">
					<input type="hidden" name="id" value={inv.id} />
					<span class="text-xs text-gray-600"
						>コピーすると招待を再発行し、以前のリンクは無効になります</span
					>
					<button class="btn">リンクをコピー</button>
				</form>
				<form method="POST" action="?/revoke" use:enhance>
					<input type="hidden" name="id" value={inv.id} />
					<button class="btn">取り消し</button>
				</form>
			</div>
		{/each}
	</section>

	<section class="card space-y-4 md:col-span-2">
		<h2 class="font-semibold">参加者</h2>
		<p class="text-xs text-gray-600">管理者は全プロジェクトに参加しています。</p>
		<ul class="space-y-1 text-sm">
			{#each data.members as m (m.id)}
				<li class="flex items-center gap-2">
					<span>{m.name}</span><span class="text-gray-500">{ROLE_LABEL[m.role]}</span>
					<form method="POST" action="?/removeMember" use:enhance class="ml-auto">
						<input type="hidden" name="id" value={m.id} />
						<button class="text-xs text-red-600">外す</button>
					</form>
				</li>
			{/each}
		</ul>
		{#if data.candidates.length > 0}
			<form method="POST" action="?/addMember" use:enhance class="flex items-end gap-2">
				<label class="block flex-1 text-sm">
					<span>追加するユーザー</span>
					<select class="input" name="id">
						{#each data.candidates as u (u.id)}<option value={u.id}
								>{u.name}（{ROLE_LABEL[u.role]}）</option
							>{/each}
					</select>
				</label>
				<button class="btn">追加</button>
			</form>
		{/if}
	</section>

	<form method="POST" action="?/archive" use:enhance class="card md:col-span-2">
		<input type="hidden" name="archived" value={data.project.archivedAt ? 'false' : 'true'} />
		<button class="btn">{data.project.archivedAt ? 'アーカイブを解除' : 'アーカイブする'}</button>
	</form>
</div>
