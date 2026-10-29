<script lang="ts">
	import { CircleCheck, CircleX } from '@lucide/svelte';
	import { toasts } from '#lib/toast.svelte.ts';
</script>

<div class="toaster" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" role={t.type === 'error' ? 'alert' : 'status'}>
			{#if t.type === 'error'}
				<CircleX size={16} color="var(--destructive)" />
			{:else}
				<CircleCheck size={16} color="var(--c-green)" />
			{/if}
			<span>{t.message}</span>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 90;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(356px, calc(100vw - 32px));
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--popover);
		color: var(--foreground);
		box-shadow: var(--shadow-pop);
		font-weight: 500;
		pointer-events: auto;
		animation: toast-in 0.2s ease;
	}
	.toast span {
		flex: 1;
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
