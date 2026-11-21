<script lang="ts">
	import { ExternalLink, LoaderCircle, X } from '@lucide/svelte';
	import IssueView from './issues/[number=int]/IssueView.svelte';

	interface Props {
		projectKey: string;
		number: number;
		onclose: () => void;
		onsaved?: () => void;
	}
	let { projectKey, number, onclose, onsaved }: Props = $props();
	const titleId = $props.id();
	const href = $derived(`/projects/${projectKey}/issues/${number}`);

	/** 入力中やダイアログ表示中の Esc はそちらに任せる */
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (document.querySelector('dialog[open]')) return;
		onclose();
	}
</script>

<svelte:window {onkeydown} />

<aside class="sheet" aria-labelledby={titleId}>
	<div class="toolbar">
		<a
			class="icon-btn"
			{href}
			target="_blank"
			rel="noopener"
			aria-label="課題詳細を新しいタブで開く"
			title="課題詳細を新しいタブで開く"
		>
			<ExternalLink />
		</a>
		<h2 id={titleId} class="mono">{projectKey}-{number}</h2>
		<button type="button" class="icon-btn" aria-label="閉じる" title="閉じる" onclick={onclose}>
			<X />
		</button>
	</div>
	<div class="scroll">
		<svelte:boundary>
			{#key number}
				<IssueView {projectKey} {number} variant="sheet" {onsaved} />
			{/key}
			{#snippet pending()}
				<div class="state"><LoaderCircle class="spin" /> 読み込み中…</div>
			{/snippet}
			{#snippet failed(error, reset)}
				<div class="state">
					{(error as { status?: number })?.status === 404
						? '課題が見つかりません'
						: '課題を読み込めませんでした'}
					<button type="button" class="btn btn-outline btn-sm" onclick={reset}>再試行</button>
				</div>
			{/snippet}
		</svelte:boundary>
	</div>
</aside>

<style>
	.sheet {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 45;
		display: flex;
		flex-direction: column;
		width: min(42.5rem, 100vw);
		background: var(--background);
		border-left: 1px solid var(--border);
		box-shadow: -8px 0 24px rgb(0 0 0 / 0.12);
		animation: slide-in 160ms ease-out;
	}
	@keyframes slide-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 48px;
		padding: 0 12px;
		border-bottom: 1px solid var(--border);
		flex: none;
	}
	.toolbar h2 {
		flex: 1;
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 20px 24px 32px;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--muted-foreground);
	}
	.state :global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
