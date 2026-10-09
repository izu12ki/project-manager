<script lang="ts">
	import { Archive, ChevronDown, ChevronRight, FolderOpen, Plus } from '@lucide/svelte';
	import { colorFor, formatDate } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const isAdmin = $derived(data.user?.role === 'admin');
	let archOpen = $state(false);

	/** Markdown の説明をカード用の 1 段落テキストにする */
	const plain = (md: string) =>
		md
			.replace(/[#>*_`~[\]()-]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
</script>

<section class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="grid gap-1">
			<h1 class="page-title">プロジェクト</h1>
			<p class="page-desc">参加しているプロジェクトの一覧です</p>
		</div>
		{#if isAdmin}
			<a href="/admin/projects/new" class="btn btn-primary"><Plus />新規プロジェクト</a>
		{/if}
	</div>

	{#if data.active.length === 0}
		<div class="empty">
			<span class="empty-icon"><FolderOpen /></span>
			<div class="grid gap-1">
				<div class="empty-title">参加しているプロジェクトはありません</div>
				<div class="text-muted-foreground">
					{isAdmin ? '最初のプロジェクトを作成しましょう' : '管理者からの招待をお待ちください'}
				</div>
			</div>
		</div>
	{:else}
		<ul class="projects">
			{#each data.active as p (p.id)}
				<li>
					<a href={`/projects/${p.key}`} class="card project">
						<div class="grid gap-1.5">
							<div class="mb-1.5 flex items-center gap-2.5">
								<span class="avatar avatar-square" style="--size: 36px" style:--c={colorFor(p.key)}
									>{p.key[0]}</span
								>
								<span class="mono text-xs font-medium text-muted-foreground">{p.key}</span>
							</div>
							<h2 class="m-0 text-base font-bold">{p.name}</h2>
							{#if p.description}
								<p class="desc">{plain(p.description)}</p>
							{/if}
						</div>
						<div class="mt-auto text-[13px] text-muted-foreground">
							更新 {formatDate(p.updatedAt)}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.archived.length > 0}
		<div class="grid gap-3">
			<button
				type="button"
				class="btn btn-ghost btn-sm -ml-2.5 justify-self-start"
				aria-expanded={archOpen}
				onclick={() => (archOpen = !archOpen)}
			>
				{#if archOpen}<ChevronDown />{:else}<ChevronRight />{/if}<Archive />アーカイブ済み（{data
					.archived.length}）
			</button>
			{#if archOpen}
				<ul class="projects">
					{#each data.archived as p (p.id)}
						<li>
							<a href={`/projects/${p.key}`} class="archived">
								<div class="flex items-center gap-2">
									<span class="mono text-xs">{p.key}</span>
									<span class="tag">アーカイブ</span>
								</div>
								<div class="font-semibold text-foreground">{p.name}</div>
								{#if p.description}<div class="desc text-[13px]">{plain(p.description)}</div>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>

<style>
	.projects {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}
	.project {
		height: 100%;
		padding: 20px;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}
	.project:hover {
		transform: translateY(-3px);
		box-shadow:
			0 2px 4px oklch(0.3 0.05 265 / 0.05),
			0 20px 40px -16px oklch(0.35 0.12 268 / 0.35);
	}
	.desc {
		margin: 0;
		color: var(--muted-foreground);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.archived {
		display: grid;
		gap: 6px;
		padding: 16px 20px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.archived:hover {
		color: var(--foreground);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 6px;
		border-radius: 6px;
		background: var(--background);
		font-size: 11px;
		font-weight: 500;
	}
</style>
