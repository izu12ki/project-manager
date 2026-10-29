<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Bold, Code, Link, List, ListChecks, Strikethrough, TextQuote } from '@lucide/svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import {
		insertUploads,
		onPendingUploadsChange,
		pendingUploads,
		uploadable
	} from '#lib/attachment-upload.ts';
	import { autosize } from '#lib/autosize.ts';
	import type { Format } from '#lib/editor/commands.ts';
	import type { MarkdownEditorHandle } from '#lib/editor/create-editor.ts';
	import type { MentionCandidate } from '#lib/mentions.ts';
	import AttachButton from './AttachButton.svelte';
	import EditorMentionMenu from './EditorMentionMenu.svelte';
	import MentionMenu from './MentionMenu.svelte';

	type Commands = typeof import('#lib/editor/commands.ts');
	type MentionApi = typeof import('#lib/editor/mention-query.ts');
	type UploadsApi = typeof import('#lib/editor/uploads.ts');
	type Mode = 'rich' | 'source';

	let {
		value = $bindable(''),
		projectKey,
		mentionCandidates,
		label,
		...rest
	}: HTMLTextareaAttributes & {
		value?: string;
		projectKey?: string;
		mentionCandidates?: MentionCandidate[];
		/** 見たまま編集の領域の aria-label */
		label: string;
	} = $props();

	const MODE_KEY = 'md-editor-mode';
	const uid = $props.id();
	const linkErrorId = `${uid}-link-error`;

	let textarea = $state<HTMLTextAreaElement>();
	let body = $state<HTMLDivElement>();
	let mode = $state<Mode>('rich');
	// Lexical は動的 import で読み込む。読み込みが終わるまでは textarea で編集する
	let handle = $state.raw<MarkdownEditorHandle | null>(null);
	let commands = $state.raw<Commands | null>(null);
	let mentionApi = $state.raw<MentionApi | null>(null);
	let uploadsApi = $state.raw<UploadsApi | null>(null);
	/** エディタにアップロード中の仮の要素があるか（あればモードを切り替えさせない） */
	let editorUploading = $state(false);
	/** textarea（「Markdown ソースのまま編集」）にアップロード中のものがあるか。
	 * 見たまま編集に切り替えるとプレースホルダが書き出しでエスケープされ、結果を差し込めなくなる */
	let sourceUploading = $state(false);
	const uploading = $derived(editorUploading || sourceUploading);
	let active = $state.raw(new Set<Format>());
	let invalid = $state(false);
	let linkOpen = $state(false);
	let linkUrl = $state('');
	let linkError = $state(false);

	const rich = $derived(mode === 'rich' && handle !== null);
	const minRows = $derived(Number(rest.rows) || 2);

	/** エディタが表している Markdown（textarea の値と比べて、外からの変更を見分ける） */
	let synced = '';
	/** エディタからの書き込みで発火した input を無視するためのフラグ */
	let selfInput = false;

	/** エディタの変更を textarea に書き、bind:value・remote form に知らせる */
	function onEditorChange(md: string) {
		const el = textarea!;
		invalid = false;
		synced = md;
		if (el.value === md) return;
		el.value = md;
		selfInput = true;
		try {
			el.dispatchEvent(new Event('input', { bubbles: true }));
		} finally {
			selfInput = false;
		}
	}

	/** textarea の値がエディタと違えば読み込み直す（見たまま編集のときだけ） */
	function syncFromTextarea() {
		const el = textarea;
		if (!el || !handle || mode !== 'rich' || el.value === synced) return;
		synced = el.value;
		handle.setMarkdown(synced);
	}

	function focusEditor() {
		handle?.editor.focus(undefined, { defaultSelection: 'rootEnd' });
	}

	onMount(() => {
		try {
			if (localStorage.getItem(MODE_KEY) === 'source') mode = 'source';
		} catch {
			// localStorage が使えない環境では見たまま編集のまま
		}

		let disposed = false;
		let cleanup = () => {};

		async function load() {
			const [{ createMarkdownEditor }, cmds, mention, ups] = await Promise.all([
				import('#lib/editor/create-editor.ts'),
				import('#lib/editor/commands.ts'),
				import('#lib/editor/mention-query.ts'),
				import('#lib/editor/uploads.ts')
			]);
			if (disposed || !body || !textarea) return;
			const hadFocus = document.activeElement === textarea;
			// Lexical は contenteditable を付けないので、root にする前に付ける
			body.contentEditable = 'true';
			const h = createMarkdownEditor({ root: body, onChange: onEditorChange });
			synced = textarea.value;
			h.setMarkdown(synced);
			const offTab = cmds.registerListTab(h.editor);
			const offActive = h.editor.registerUpdateListener(() => {
				active = cmds.activeFormats(h.editor);
			});
			const offUploads = projectKey
				? ups.registerEditorUploads(h.editor, {
						projectKey,
						form: () => textarea?.form ?? null,
						onUploadingChange: (u) => (editorUploading = u)
					})
				: () => {};
			cleanup = () => {
				offTab();
				offActive();
				offUploads();
				h.destroy();
			};
			commands = cmds;
			mentionApi = mention;
			uploadsApi = ups;
			handle = h;
			if (hadFocus && mode === 'rich') {
				await tick();
				focusEditor();
			}
		}

		const start = () => {
			// チャンクの読み込みに失敗しても textarea のまま編集・送信できる
			load().catch((e) => console.error('エディタの読み込みに失敗しました', e));
		};
		const idle = 'requestIdleCallback' in window;
		// 手が空かない間（CI など）もいつまでも textarea のままにしないよう、待つのは 1 秒まで
		const id = idle ? requestIdleCallback(start, { timeout: 1000 }) : setTimeout(start, 200);
		return () => {
			disposed = true;
			if (idle) cancelIdleCallback(id as number);
			else clearTimeout(id);
			cleanup();
		};
	});

	// 外から value が書き換わったとき（呼び出し側のリセットなど）もエディタに反映する
	$effect(() => {
		void value;
		void handle;
		syncFromTextarea();
	});

	$effect(() => {
		const el = textarea;
		if (!el) return;
		sourceUploading = pendingUploads(el) > 0;
		return onPendingUploadsChange(el, (n) => (sourceUploading = n > 0));
	});

	// form.reset() は input を発火しないので、値が戻った後に読み込み直す
	$effect(() => {
		const form = textarea?.form;
		if (!form) return;
		const onReset = () => requestAnimationFrame(syncFromTextarea);
		// 隠れた textarea には required の吹き出しが出ないので、代わりにエディタで知らせる
		const onSubmit = (e: SubmitEvent) => {
			if (!rich || !textarea?.required || textarea.value !== '') return;
			e.preventDefault();
			e.stopImmediatePropagation();
			showInvalid();
		};
		form.addEventListener('reset', onReset);
		form.addEventListener('submit', onSubmit, true);
		return () => {
			form.removeEventListener('reset', onReset);
			form.removeEventListener('submit', onSubmit, true);
		};
	});

	function showInvalid() {
		invalid = true;
		focusEditor();
	}

	/** 隠れた textarea の検証に失敗したとき（ブラウザは submit を発火せずに止める） */
	function oninvalid(e: Event) {
		if (!rich) return;
		e.preventDefault();
		showInvalid();
	}

	function oninput() {
		if (selfInput) return;
		invalid = false;
		syncFromTextarea();
	}

	// rest の oninput（呼び出し側のもの）を上書きしないよう、属性ではなく addEventListener で受ける
	const listen: Attachment<HTMLTextAreaElement> = (el) => {
		el.addEventListener('input', oninput);
		el.addEventListener('invalid', oninvalid);
		return () => {
			el.removeEventListener('input', oninput);
			el.removeEventListener('invalid', oninvalid);
		};
	};

	// 「Markdown ソースのまま編集」のときだけ高さを内容に合わせる。隠れている間は測れないので、
	// rich が変わるたびに付け直し、表示されたときに測り直す
	const fitSource: Attachment<HTMLTextAreaElement> = (el) => {
		if (!rich) return autosize(el);
	};

	/** 添付ボタンのファイル。見たまま編集ならキャレット位置に、そうでなければ textarea に入れる */
	function onFiles(files: File[]) {
		if (!projectKey || !textarea) return;
		if (rich && handle && uploadsApi) {
			void uploadsApi.insertUploadsIntoEditor(handle.editor, textarea.form, projectKey, files);
		} else void insertUploads(textarea, projectKey, files);
	}

	async function toggleMode() {
		if (uploading) return;
		mode = mode === 'rich' ? 'source' : 'rich';
		linkOpen = false;
		try {
			localStorage.setItem(MODE_KEY, mode);
		} catch {
			// 覚えられなくても切り替えはできる
		}
		syncFromTextarea();
		await tick();
		if (rich) focusEditor();
		else textarea?.focus();
	}

	// ---- 「Markdown ソースのまま編集」のモード（textarea）での書式 ----

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
		{ f: 'bold', label: '太字', icon: Bold, source: () => wrap('**', '**', '太字') },
		{
			f: 'strikethrough',
			label: '打ち消し線',
			icon: Strikethrough,
			source: () => wrap('~~', '~~', '打ち消し線')
		},
		{ f: 'code', label: 'コード', icon: Code, source: code },
		{ f: 'link', label: 'リンク', icon: Link, source: () => wrap('[', '](https://)', 'リンク') },
		{ f: 'bullet', label: '箇条書き', icon: List, source: () => prefixLines('- ') },
		{ f: 'check', label: 'チェックリスト', icon: ListChecks, source: () => prefixLines('- [ ] ') },
		{ f: 'quote', label: '引用', icon: TextQuote, source: () => prefixLines('> ') }
	] as const;

	function runTool(t: (typeof tools)[number]) {
		if (!rich || !handle || !commands) return t.source();
		if (t.f === 'link' && !active.has('link')) {
			linkUrl = '';
			linkError = false;
			linkOpen = true;
			return;
		}
		commands.runFormat(handle.editor, t.f);
		focusEditor();
	}

	function onLinkKeydown(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'Enter') {
			// フォームを送信させない
			e.preventDefault();
			const url = linkUrl.trim();
			if (url && handle && commands && !commands.setLink(handle.editor, url)) {
				// 使えない URL はリンクにせず、直せるよう開いたままにする
				linkError = true;
				return;
			}
			closeLink();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closeLink();
		}
	}

	function closeLink() {
		linkOpen = false;
		focusEditor();
	}

	/** ツールバーのボタンを押してもエディタの選択を失わないようにする */
	const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<div class="editor" style:--rows={minRows}>
	<textarea
		bind:this={textarea}
		bind:value
		{...rest}
		hidden={rich}
		{@attach listen}
		{@attach fitSource}
		{@attach projectKey && uploadable(projectKey)}></textarea>
	<div class="body-wrap" hidden={!rich}>
		<div
			bind:this={body}
			role="textbox"
			tabindex="0"
			aria-multiline="true"
			aria-label={label}
			aria-invalid={invalid || undefined}
			class="markdown editor-body"
		></div>
		{#if !value && rest.placeholder}
			<div class="placeholder" aria-hidden="true">{rest.placeholder}</div>
		{/if}
		{#if invalid}
			<p class="invalid" role="alert">入力してください</p>
		{/if}
		{#if linkOpen}
			<div class="link-pop">
				<input
					class="input"
					type="url"
					placeholder="https://"
					aria-label="リンクの URL"
					aria-invalid={linkError || undefined}
					aria-describedby={linkError ? linkErrorId : undefined}
					bind:value={linkUrl}
					oninput={() => (linkError = false)}
					onkeydown={onLinkKeydown}
					onblur={() => (linkOpen = false)}
					{@attach (el) => el.focus()}
				/>
				{#if linkError}
					<p class="link-error" id={linkErrorId} role="alert">このURLは使えません</p>
				{/if}
			</div>
		{/if}
	</div>
	<div class="toolbar" role="toolbar" aria-label="書式">
		<span class="hint"
			>Markdown が使えます{mentionCandidates ? '・@ でメンション' : ''}{projectKey
				? '・ファイルは貼り付けかドロップでも添付できます'
				: ''}</span
		>
		<span style="flex: 1"></span>
		{#each tools as t (t.f)}
			{@const on = rich && active.has(t.f)}
			<button
				type="button"
				class="icon-btn"
				class:active={on}
				aria-label={t.label}
				title={t.label}
				aria-pressed={rich ? on : undefined}
				onmousedown={keepFocus}
				onclick={() => runTool(t)}
			>
				<t.icon />
			</button>
		{/each}
		{#if projectKey}
			<AttachButton {onFiles} />
		{/if}
		<button
			type="button"
			class="icon-btn md-toggle"
			class:active={mode === 'source'}
			aria-label="Markdown ソースのまま編集"
			title={uploading ? 'アップロードが終わるまで切り替えられません' : 'Markdown ソースのまま編集'}
			aria-pressed={mode === 'source'}
			disabled={uploading}
			onmousedown={keepFocus}
			onclick={toggleMode}
		>
			<span aria-hidden="true">MD</span>
		</button>
	</div>
	{#if mentionCandidates}
		{#if rich && handle && mentionApi}
			<EditorMentionMenu editor={handle.editor} api={mentionApi} candidates={mentionCandidates} />
		{:else if !rich}
			<MentionMenu target={() => textarea} candidates={mentionCandidates} />
		{/if}
	{/if}
</div>

<style>
	.editor {
		display: grid;
		border: 1px solid var(--input);
		border-radius: var(--radius-sm);
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
		/* 高さは autosize で内容に合わせる。.editor-body と同じ上限を超えたらスクロールする */
		max-height: 60vh;
		overflow-y: auto;
		resize: none;
		outline: none;
	}
	.body-wrap {
		position: relative;
	}
	/* 「Markdown ソースのまま編集」は文字の「MD」で示す */
	.md-toggle {
		width: auto;
		padding: 0 6px;
		margin-left: 4px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.editor-body {
		min-height: calc(var(--rows) * 1.7em + 20px);
		/* 今の .textarea.autosize と同じ上限。超えたらスクロールする */
		max-height: 60vh;
		overflow-y: auto;
		padding: 10px 12px;
		line-height: 1.7;
		outline: none;
		color: var(--foreground);
	}
	.placeholder {
		position: absolute;
		top: 10px;
		left: 12px;
		right: 12px;
		line-height: 1.7;
		color: var(--muted-foreground);
		pointer-events: none;
		user-select: none;
	}
	/* 本文に重ならないよう、編集領域の下に並べる */
	.invalid {
		margin: 0;
		padding: 2px 12px 6px;
		color: var(--destructive, #dc2626);
		font-size: 0.75rem;
	}
	.link-pop {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 10;
		width: min(320px, calc(100% - 16px));
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--popover, var(--background));
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
	}
	.link-pop .input {
		width: 100%;
	}
	.link-error {
		margin: 4px 2px 0;
		color: var(--destructive, #dc2626);
		font-size: 0.75rem;
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
	.toolbar .active {
		background: var(--accent);
		color: var(--foreground);
	}
	.hint {
		font-size: 0.75rem;
	}
</style>
