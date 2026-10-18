// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { $dfs } from '@lexical/utils';
import { $createParagraphNode, $createTextNode, $getRoot, PASTE_COMMAND } from 'lexical';
import type { UploadResult } from '$lib/attachment-upload';
import { createMarkdownEditor } from './create-editor';
import { $isUploadPlaceholderNode } from './nodes';
import { insertUploadsIntoEditor, registerEditorUploads } from './uploads';

vi.mock('$lib/toast.svelte', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function setup(text = '', root: HTMLElement | null = null) {
	const h = createMarkdownEditor({ root });
	h.editor.update(
		() => {
			const p = $createParagraphNode();
			$getRoot().clear().append(p);
			if (text) {
				const t = $createTextNode(text);
				p.append(t);
				t.select(text.length, text.length);
			} else p.select();
		},
		{ discrete: true }
	);
	return h;
}

const placeholders = (h: ReturnType<typeof setup>) =>
	h.editor.read(() => $dfs().filter(({ node }) => $isUploadPlaceholderNode(node)).length);

const file = (name: string, type: string) => new File(['x'], name, { type });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('insertUploadsIntoEditor', () => {
	it('アップロード中は仮の要素を出し、終わったら画像に置き換える', async () => {
		const h = setup();
		const d = deferred<UploadResult>();
		const upload = vi.fn(() => d.promise);
		const done = insertUploadsIntoEditor(h.editor, null, 'A', [file('a.png', 'image/png')], upload);
		await flush();
		expect(upload).toHaveBeenCalledWith('A', expect.any(File));
		expect(h.getMarkdown()).toBe('');
		expect(placeholders(h)).toBe(1);
		d.resolve({ id: '1', url: '/projects/A/attachments/1', filename: 'a.png', isImage: true });
		await done;
		expect(placeholders(h)).toBe(0);
		expect(h.getMarkdown()).toBe('![a.png](/projects/A/attachments/1)');
	});

	it('画像以外はリンクにする', async () => {
		const h = setup();
		const upload = vi.fn(async () => ({
			id: '2',
			url: '/projects/A/attachments/2',
			filename: 'spec.pdf',
			isImage: false
		}));
		await insertUploadsIntoEditor(
			h.editor,
			null,
			'A',
			[file('spec.pdf', 'application/pdf')],
			upload
		);
		expect(h.getMarkdown()).toBe('[spec.pdf](/projects/A/attachments/2)');
	});

	it('失敗したら仮の要素を消す', async () => {
		const h = setup('本文');
		h.setMarkdown('本文');
		h.editor.update(() => $getRoot().selectEnd(), { discrete: true });
		const upload = vi.fn(async () => {
			throw new Error('ファイルは25MB以下にしてください');
		});
		await insertUploadsIntoEditor(h.editor, null, 'A', [file('a.png', 'image/png')], upload);
		expect(placeholders(h)).toBe(0);
		expect(h.getMarkdown()).toBe('本文');
		const { toast } = await import('$lib/toast.svelte');
		expect(toast.error).toHaveBeenCalledWith('ファイルは25MB以下にしてください');
	});

	it('行の途中では改行してから入れる', async () => {
		const h = setup('前');
		const upload = vi.fn(async () => ({
			id: '3',
			url: '/projects/A/attachments/3',
			filename: 'b.png',
			isImage: true
		}));
		await insertUploadsIntoEditor(h.editor, null, 'A', [file('b.png', 'image/png')], upload);
		expect(h.getMarkdown()).toMatch(/^前\\?\n!\[b\.png\]\(\/projects\/A\/attachments\/3\)$/);
	});

	it('アップロード中はフォームの送信を止める', async () => {
		const h = setup();
		const form = document.createElement('form');
		document.body.appendChild(form);
		const d = deferred<UploadResult>();
		const done = insertUploadsIntoEditor(
			h.editor,
			form,
			'A',
			[file('a.png', 'image/png')],
			() => d.promise
		);
		await flush();
		const blocked = new Event('submit', { cancelable: true });
		form.dispatchEvent(blocked);
		expect(blocked.defaultPrevented).toBe(true);
		d.resolve({ id: '1', url: '/projects/A/attachments/1', filename: 'a.png', isImage: true });
		await done;
		const ok = new Event('submit', { cancelable: true });
		form.dispatchEvent(ok);
		expect(ok.defaultPrevented).toBe(false);
	});

	it('仮の要素がユーザーに消されていたら何もしない', async () => {
		const h = setup();
		const d = deferred<UploadResult>();
		const done = insertUploadsIntoEditor(
			h.editor,
			null,
			'A',
			[file('a.png', 'image/png')],
			() => d.promise
		);
		await flush();
		h.setMarkdown('別の内容');
		d.resolve({ id: '1', url: '/projects/A/attachments/1', filename: 'a.png', isImage: true });
		await done;
		expect(h.getMarkdown()).toBe('別の内容');
	});
});

describe('registerEditorUploads', () => {
	it('ファイルだけの貼り付けをアップロードし、アップロード中を知らせる', async () => {
		// 仮の要素の増減（mutation listener）は DOM に描画したときだけ届く
		const root = document.createElement('div');
		root.contentEditable = 'true';
		document.body.appendChild(root);
		const h = setup('', root);
		const d = deferred<UploadResult>();
		const states: boolean[] = [];
		registerEditorUploads(h.editor, {
			projectKey: 'A',
			form: () => null,
			onUploadingChange: (u) => states.push(u),
			upload: () => d.promise
		});
		const f = file('a.png', 'image/png');
		const event = {
			clipboardData: { types: ['Files'], files: [f] },
			preventDefault: vi.fn()
		} as unknown as ClipboardEvent;
		expect(h.editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
		expect(event.preventDefault).toHaveBeenCalled();
		await flush();
		expect(states.at(-1)).toBe(true);
		d.resolve({ id: '1', url: '/projects/A/attachments/1', filename: 'a.png', isImage: true });
		await vi.waitFor(() => expect(h.getMarkdown()).toBe('![a.png](/projects/A/attachments/1)'));
		await flush();
		expect(states.at(-1)).toBe(false);
	});

	it('テキストを含む貼り付けは横取りしない', () => {
		const h = setup();
		const upload = vi.fn();
		registerEditorUploads(h.editor, { projectKey: 'A', form: () => null, upload });
		const event = {
			clipboardData: {
				types: ['text/plain', 'Files'],
				files: [file('a.png', 'image/png')],
				getData: (t: string) => (t === 'text/plain' ? 'hello' : '')
			},
			preventDefault: vi.fn()
		} as unknown as ClipboardEvent;
		h.editor.dispatchCommand(PASTE_COMMAND, event);
		expect(upload).not.toHaveBeenCalled();
	});
});
