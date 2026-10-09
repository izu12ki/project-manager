<script lang="ts">
	import { page } from '$app/state';
	import { FolderKanban, LogOut, UserRound, Users } from '@lucide/svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { LightSwitch } from '$lib/components/ui/light-switch';

	let {
		user,
		projects
	}: {
		user: { name: string; role: 'admin' | 'member' | 'guest' };
		projects: { key: string; name: string; archived: boolean }[];
	} = $props();

	const active = $derived(projects.filter((p) => !p.archived));
	const isCurrent = (key: string) => {
		const base = `/projects/${key}`;
		const pathname = page.url.pathname;
		return pathname === base || pathname.startsWith(base + '/');
	};
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<a href="/" {...props}><FolderKanban />Project Manager</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>参加プロジェクト一覧</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each active as p (p.key)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={isCurrent(p.key)}>
							{#snippet child({ props })}
								<a href={`/projects/${p.key}`} {...props}>
									<span class="text-muted-foreground">{p.key}</span>
									<span class="truncate">{p.name}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		{#if user.role === 'admin'}
			<Sidebar.Group>
				<Sidebar.GroupLabel>管理</Sidebar.GroupLabel>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={page.url.pathname.startsWith('/admin/users')}>
							{#snippet child({ props })}
								<a href="/admin/users" {...props}><Users />ユーザー</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.Group>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton isActive={page.url.pathname === '/account'}>
					{#snippet child({ props })}
						<a href="/account" {...props}><UserRound />{user.name}</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<div class="flex items-center gap-2">
			<form method="POST" action="/logout" class="flex-1">
				<Button type="submit" variant="ghost" size="sm" class="w-full justify-start">
					<LogOut data-icon="inline-start" />ログアウト
				</Button>
			</form>
			<LightSwitch variant="ghost" size="sm" />
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
