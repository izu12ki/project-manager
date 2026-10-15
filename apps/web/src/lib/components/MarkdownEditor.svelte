<script lang="ts">
	import { Bold, Code, Link, List, ListChecks } from '@lucide/svelte';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { uploadable } from '$lib/attachment-upload';
	import type { MentionCandidate } from '$lib/mentions';
	import AttachButton from './AttachButton.svelte';
	import MentionMenu from './MentionMenu.svelte';

	let {
		value = $bindable(''),
		projectKey,
		mentionCandidates,
		...rest
	}: HTMLTextareaAttributes & {
		value?: string;
		projectKey?: string;
		mentionCandidates?: MentionCandidate[];
	} = $props();
	let textarea = $state<HTMLTextAreaElement>();

	/** 選択範囲を before/after で囲む（未選択なら placeholder を入れて選択する） */
	function wrap(before: string, after: string, placeholder: string) {
		const el = textarea!;
		const { selectionStart: s, selectionEnd: e } = el;
		const sel = el.value.slice(s, e) || placeholder;
		el.setRangeText(before + sel + after, s, e);
		el.setSelectionRange(s + before.length, s + before.length + sel.length);
		commit();
	}

	/** 選択している各行の先頭に prefix を付ける */
	function prefixLines(prefix: string) {
		const el = textarea!;
		const start = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
		const end = el.selectionEnd;
		const lines = el.value.slice(start, end).split('\n');
		const text = lines.map((l) => prefix + l).join('\n');
		el.setRangeText(text, start, end);
		el.setSelectionRange(start + text.length, start + text.length);
		commit();
	}

	function code() {
		const el = textarea!;
		const sel = el.value.slice(el.selectionStart, el.selectionEnd);
		if (sel.includes('\n')) wrap('```\n', '\n```', '');
		else wrap('`', '`', 'code');
	}

	function commit() {
		value = textarea!.value;
		textarea!.focus();
	}

	const tools = [
		{ label: '太字', icon: Bold, run: () => wrap('**', '**', '太字') },
		{ label: '箇条書き', icon: List, run: () => prefixLines('- ') },
		{ label: 'チェックリスト', icon: ListChecks, run: () => prefixLines('- [ ] ') },
		{ label: 'コード', icon: Code, run: code },
		{ label: 'リンク', icon: Link, run: () => wrap('[', '](https://)', 'リンク') }
	];
</script>

<div class="editor">
	<textarea bind:this={textarea} bind:value {...rest} {@attach projectKey && uploadable(projectKey)}
	></textarea>
	<div class="toolbar" role="toolbar" aria-label="書式">
		<span class="hint"
			>Markdown が使えます{mentionCandidates ? '・@ でメンション' : ''}{projectKey
				? '・ファイルは貼り付けかドロップでも添付できます'
				: ''}</span
		>
		<span style="flex: 1"></span>
		{#each tools as t (t.label)}
			<button type="button" class="icon-btn" aria-label={t.label} title={t.label} onclick={t.run}>
				<t.icon />
			</button>
		{/each}
		{#if projectKey}
			<AttachButton {projectKey} target={() => textarea} />
		{/if}
	</div>
	{#if mentionCandidates}<MentionMenu target={() => textarea} candidates={mentionCandidates} />{/if}
</div>

<style>
	.editor {
		display: grid;
		border: 1px solid var(--input);
		border-radius: 4px;
		overflow: hidden;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.editor:focus-within {
		border-color: var(--ring);
		box-shadow: 0 0 0 3px var(--ring-soft);
	}
	textarea {
		width: 100%;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--foreground);
		line-height: 1.7;
		resize: vertical;
		outline: none;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px 6px 4px 12px;
		border-top: 1px solid var(--border);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.hint {
		font-size: 12px;
	}
</style>
