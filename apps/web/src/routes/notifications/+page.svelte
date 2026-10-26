<script lang="ts">
	import { goto } from '$app/navigation';
	import { colorFor, formatDateTime } from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import {
		getNotifications,
		openNotification,
		readAllNotifications
	} from '$lib/notifications.remote';

	const items = $derived(await getNotifications());
	const hasUnread = $derived(items.some((n) => !n.read));

	async function open(id: string) {
		try {
			const { href } = await openNotification({ id });
			await goto(href);
		} catch {
			toast.error('通知を開けませんでした');
		}
	}

	async function readAll() {
		try {
			await readAllNotifications();
		} catch {
			toast.error('既読にできませんでした');
		}
	}
</script>

<svelte:head><title>通知 | Project Manager</title></svelte:head>

<section class="grid w-full max-w-[800px] gap-4">
	<div class="flex items-center justify-between gap-4">
		<h1 class="m-0 text-xl font-bold">通知</h1>
		<button type="button" class="btn btn-outline btn-sm" disabled={!hasUnread} onclick={readAll}
			>すべて既読にする</button
		>
	</div>
	{#if items.length === 0}
		<p class="card m-0 text-muted-foreground">通知はありません</p>
	{:else}
		<ul class="card list notif-list">
			{#each items as n (n.id)}
				<li>
					<button type="button" class="notif" class:unread={!n.read} onclick={() => open(n.id)}>
						<span class="avatar" style:--c={colorFor(n.actorName)}>{n.actorName[0]}</span>
						<span class="grid min-w-0 gap-0.5 text-left">
							<span class="truncate"
								><span class="font-medium">{n.actorName}</span> さんが {n.summary}</span
							>
							<span class="truncate text-xs text-muted-foreground"
								>{#if n.issueNumber === null}{n.projectKey}{:else}{n.projectKey}-{n.issueNumber}
									{n.issueTitle}{/if} · {formatDateTime(n.createdAt)}</span
							>
						</span>
						{#if !n.read}<span class="dot" aria-label="未読"></span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.notif-list {
		padding: 0;
	}
	.notif {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 16px;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.notif:hover {
		background: var(--muted);
	}
	.notif.unread {
		background: var(--ring-soft);
	}
	.dot {
		margin-left: auto;
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--primary);
	}
</style>
