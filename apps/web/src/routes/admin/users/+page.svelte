<script lang="ts">
	import { enhance } from '$app/forms';
	import InviteLinkBox from '$lib/components/InviteLinkBox.svelte';
	import { ROLE_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">ユーザー</h1>
{#if form?.message}<p role="alert" class="mb-4 text-sm text-red-600">{form.message}</p>{/if}

<section class="card mb-8 space-y-4">
	<h2 class="font-semibold">招待</h2>
	<form method="POST" action="?/invite" use:enhance class="grid gap-4 md:grid-cols-4 md:items-end">
		<label class="block md:col-span-2">
			<span class="text-sm">メールアドレス</span>
			<input class="input" name="email" type="email" required />
		</label>
		<label class="block">
			<span class="text-sm">ロール</span>
			<select class="input" name="role">
				<option value="member">メンバー</option>
				<option value="guest">ゲスト</option>
			</select>
		</label>
		<label class="block">
			<span class="text-sm">参加プロジェクト（ゲストは必須）</span>
			<select class="input" name="projectId">
				<option value="">なし</option>
				{#each data.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		</label>
		<button class="btn-primary md:col-span-4 md:justify-self-start">招待する</button>
	</form>
	{#if form?.inviteUrl}<InviteLinkBox url={form.inviteUrl} />{/if}
</section>

<section class="mb-8">
	<h2 class="mb-2 font-semibold">未使用の招待</h2>
	{#if data.invitations.length === 0}<p class="text-sm text-gray-600">ありません。</p>{/if}
	<ul class="space-y-2">
		{#each data.invitations as inv (inv.id)}
			<li class="card flex flex-wrap items-center gap-3 text-sm">
				<span>{inv.email}</span>
				<span class="text-gray-500"
					>{ROLE_LABEL[inv.role]}{inv.projectName ? ` / ${inv.projectName}` : ''}</span
				>
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
			</li>
		{/each}
	</ul>
</section>

<section>
	<h2 class="mb-2 font-semibold">登録済みユーザー</h2>
	<table class="w-full bg-white text-sm">
		<thead class="text-left text-gray-500">
			<tr
				><th class="p-2">名前</th><th class="p-2">メール</th><th class="p-2">ロール</th><th
					class="p-2"
				></th></tr
			>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr class="border-t border-gray-200">
					<td class="p-2">{u.name}</td>
					<td class="p-2">{u.email}</td>
					<td class="p-2">{ROLE_LABEL[u.role]}</td>
					<td class="p-2 text-right">
						{#if u.disabledAt}
							<span class="mr-2 text-gray-500">無効</span>
							<form method="POST" action="?/enable" use:enhance class="inline">
								<input type="hidden" name="id" value={u.id} />
								<button class="btn">有効化</button>
							</form>
						{:else if u.id !== data.user?.id}
							<form
								method="POST"
								action="?/disable"
								use:enhance={({ cancel }) => {
									if (!confirm(`${u.name} を無効化しますか？ すぐにログアウトされます`)) cancel();
								}}
							>
								<input type="hidden" name="id" value={u.id} />
								<button class="btn">無効化</button>
							</form>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
