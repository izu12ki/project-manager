<script lang="ts">
	import { caretRect } from '$lib/caret';
	import {
		filterCandidates,
		findMentionQuery,
		mentionToken,
		type MentionCandidate
	} from '$lib/mentions';

	let {
		target,
		candidates
	}: { target: () => HTMLTextAreaElement | undefined; candidates: MentionCandidate[] } = $props();

	let open = $state<{ start: number; query: string } | null>(null);
	let active = $state(0);
	let pos = $state({ left: 0, top: 0 });
	const items = $derived(open ? filterCandidates(candidates, open.query) : []);
	const listId = `mention-${Math.random().toString(36).slice(2)}`;

	function sync() {
		const el = target();
		if (!el) return;
		const q =
			el.selectionStart === el.selectionEnd ? findMentionQuery(el.value, el.selectionStart) : null;
		if (!q) {
			open = null;
			return;
		}
		if (open?.start !== q.start || open?.query !== q.query) active = 0;
		open = q;
		const r = caretRect(el, q.start);
		pos = { left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: r.bottom + 4 };
	}

	function pick(c: MentionCandidate | undefined) {
		const el = target();
		if (!el || !c) return;
		// キャッシュした open ではなく、現在のキャレットから範囲を求め直す
		const q =
			el.selectionStart === el.selectionEnd ? findMentionQuery(el.value, el.selectionStart) : null;
		if (!q) {
			open = null;
			return;
		}
		el.setRangeText(`${mentionToken(c)} `, q.start, el.selectionStart, 'end');
		// bind:value・autosize・remote form に変更を知らせる
		el.dispatchEvent(new Event('input', { bubbles: true }));
		open = null;
		el.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		// 日本語入力の変換確定の Enter では選ばない
		if (!open || items.length === 0 || e.isComposing) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const d = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + d + items.length) % items.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			pick(items[Math.min(active, items.length - 1)]);
		} else if (e.key === 'Escape') {
			open = null;
		} else return;
		e.preventDefault();
		e.stopPropagation();
	}

	// 矢印・Home/End などキャレット移動で候補の状態を合わせ直す（メニュー操作のキーは除く）
	function onkeyup(e: KeyboardEvent) {
		if (e.isComposing || ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
		sync();
	}

	$effect(() => {
		const el = target();
		if (!el) return;
		const close = () => (open = null);
		el.addEventListener('input', sync);
		el.addEventListener('click', sync);
		el.addEventListener('keydown', onkeydown, true);
		el.addEventListener('keyup', onkeyup);
		el.addEventListener('select', sync);
		el.addEventListener('blur', close);
		el.setAttribute('aria-autocomplete', 'list');
		return () => {
			el.removeEventListener('input', sync);
			el.removeEventListener('click', sync);
			el.removeEventListener('keydown', onkeydown, true);
			el.removeEventListener('keyup', onkeyup);
			el.removeEventListener('select', sync);
			el.removeEventListener('blur', close);
		};
	});
</script>

{#if open && items.length > 0}
	<ul
		id={listId}
		class="mention-menu"
		role="listbox"
		aria-label="メンションする人"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
	>
		{#each items as c, i (c.id)}
			<!-- mousedown で選ぶ（click だと先に textarea の blur で閉じる） -->
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
