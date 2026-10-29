<script lang="ts">
	import type { LexicalEditor } from 'lexical';
	import { filterCandidates, type MentionCandidate } from '#lib/mentions.ts';

	// Lexical の実体は props で受け取る（このコンポーネントから静的に import しない）
	let {
		editor,
		api,
		candidates
	}: {
		editor: LexicalEditor;
		api: typeof import('#lib/editor/mention-query.ts');
		candidates: MentionCandidate[];
	} = $props();

	let open = $state<string | null>(null);
	let active = $state(0);
	let pos = $state({ left: 0, top: 0 });
	const items = $derived(open !== null ? filterCandidates(candidates, open) : []);
	const listId = `mention-${Math.random().toString(36).slice(2)}`;

	function sync() {
		const q = api.currentMentionQuery(editor);
		if (!q) {
			open = null;
			return;
		}
		if (open !== q.query) active = 0;
		open = q.query;
		if (q.rect) {
			pos = {
				left: Math.max(8, Math.min(q.rect.left, window.innerWidth - 248)),
				top: q.rect.bottom + 4
			};
		}
	}

	function pick(c: MentionCandidate | undefined) {
		if (!c) return;
		api.insertMention(editor, c);
		open = null;
		editor.focus();
	}

	function onkey(e: KeyboardEvent): boolean {
		if (open === null || items.length === 0) return false;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const d = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + d + items.length) % items.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			pick(items[Math.min(active, items.length - 1)]);
		} else if (e.key === 'Escape') {
			open = null;
		} else return false;
		return true;
	}

	$effect(() => {
		const root = editor.getRootElement();
		const close = () => (open = null);
		const offUpdate = editor.registerUpdateListener(() => sync());
		const offKeys = api.registerMentionKeys(editor, onkey);
		root?.addEventListener('blur', close);
		root?.setAttribute('aria-autocomplete', 'list');
		return () => {
			offUpdate();
			offKeys();
			root?.removeEventListener('blur', close);
			root?.removeAttribute('aria-autocomplete');
		};
	});
</script>

{#if open !== null && items.length > 0}
	<ul
		id={listId}
		class="mention-menu"
		role="listbox"
		aria-label="メンションする人"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
	>
		{#each items as c, i (c.id)}
			<!-- mousedown で選ぶ（click だと先にエディタの blur で閉じる） -->
			<li
				role="option"
				aria-selected={i === active}
				onmousedown={(e) => {
					e.preventDefault();
					pick(c);
				}}
			>
				{c.name}
			</li>
		{/each}
	</ul>
{/if}
