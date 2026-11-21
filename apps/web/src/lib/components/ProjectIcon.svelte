<script lang="ts">
	import { projectColor, projectIcon } from '#lib/labels.ts';
	import { projectIconUrl } from '#lib/project-icon.ts';

	let {
		project,
		size = 32,
		src
	}: {
		project: {
			key: string;
			icon: string | null;
			color: string | null;
			iconImageId?: string | null;
		};
		size?: number;
		/** 画像の URL を直接指定する（設定画面のプレビュー用） */
		src?: string | null;
	} = $props();

	const url = $derived(src ?? (project.iconImageId ? projectIconUrl(project.iconImageId) : null));
</script>

{#if url}
	<img
		class="avatar avatar-square project-image"
		style:--size={`${size}px`}
		src={url}
		alt=""
		width={size}
		height={size}
		data-testid="project-icon-image"
	/>
{:else}
	<span
		class="avatar avatar-square"
		style:--size={`${size}px`}
		style:--c={projectColor(project)}
		aria-hidden="true"
	>
		{projectIcon(project)}
	</span>
{/if}

<style>
	/* ロゴは切り取らずに収める。透過部分は背景色を付けない */
	.project-image {
		object-fit: contain;
		background: transparent;
	}
</style>
