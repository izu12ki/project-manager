<script lang="ts">
	import { navigating } from '$app/state';
</script>

{#if navigating.to}
	<div class="nav-progress" role="progressbar" aria-label="読み込み中"></div>
{/if}

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
		height: 2px;
		width: 100%;
		background: var(--primary);
		transform-origin: left;
		opacity: 0;
		/* 先読み済みで一瞬で終わる遷移ではバーをちらつかせない */
		animation:
			show 0s 120ms forwards,
			grow 8s 120ms cubic-bezier(0.1, 0.7, 0.2, 1) both;
		pointer-events: none;
		view-transition-name: nav-progress;
	}
	@keyframes show {
		to {
			opacity: 1;
		}
	}
	@keyframes grow {
		from {
			transform: scaleX(0.08);
		}
		to {
			transform: scaleX(0.92);
		}
	}
</style>
