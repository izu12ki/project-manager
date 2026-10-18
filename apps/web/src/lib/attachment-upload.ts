import type { Attachment } from 'svelte/attachments';
import {
	MAX_ATTACHMENT_BYTES,
	TOO_LARGE_MESSAGE,
	markdownFor,
	shouldUploadPaste,
	uploadSeparator
} from './attachment-rules';
import { toast } from './toast.svelte';

export interface UploadResult {
	id: string;
	url: string;
	filename: string;
	isImage: boolean;
}

export async function uploadFile(projectKey: string, file: File): Promise<UploadResult> {
	if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(TOO_LARGE_MESSAGE);
	const body = new FormData();
	body.append('file', file);
	const res = await fetch(`/projects/${projectKey}/attachments`, {
		method: 'POST',
		body,
		headers: { accept: 'application/json' }
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(data?.message ?? 'アップロードに失敗しました');
	}
	return res.json();
}

/** value を書き換えたことを bind:value・autosize・remote form に知らせる */
const notify = (el: HTMLTextAreaElement) => el.dispatchEvent(new Event('input', { bubbles: true }));

/** アップロード中のフォームと件数。0 になるまで送信を止める */
const uploading = new Map<HTMLFormElement, number>();

// enhance の submit ハンドラより先に動くよう capture で登録する
function blockSubmit(e: SubmitEvent) {
	e.preventDefault();
	e.stopImmediatePropagation();
	toast.error('アップロードが終わってから送信してください');
}

/** アップロード中は form の送信を止める。返した関数で解除する */
export function trackUpload(form: HTMLFormElement | null): () => void {
	if (!form) return () => {};
	const n = uploading.get(form) ?? 0;
	if (n === 0) form.addEventListener('submit', blockSubmit, true);
	uploading.set(form, n + 1);
	return () => {
		const left = (uploading.get(form) ?? 1) - 1;
		if (left > 0) return void uploading.set(form, left);
		uploading.delete(form);
		form.removeEventListener('submit', blockSubmit, true);
	};
}

/** カーソル位置にプレースホルダを入れてアップロードし、終わったらリンクに置き換える（失敗時は消す） */
async function insertUpload(el: HTMLTextAreaElement, projectKey: string, file: File) {
	const placeholder = `![アップロード中: ${file.name.replace(/[[\]]/g, '')}]()`;
	const separator = uploadSeparator(el.value.slice(0, el.selectionStart));
	el.setRangeText(separator + placeholder, el.selectionStart, el.selectionEnd, 'end');
	notify(el);
	// form 属性で外のフォームに属する textarea もあるので el.form で辿る
	const done = trackUpload(el.form);
	let replacement = '';
	try {
		replacement = markdownFor(await uploadFile(projectKey, file));
	} catch (e) {
		toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました');
	} finally {
		done();
	}
	const i = el.value.indexOf(placeholder);
	if (i === -1) return; // アップロード中にユーザーがプレースホルダを消した
	el.setRangeText(replacement, i, i + placeholder.length, 'preserve');
	notify(el);
}

/** textarea ごとの、終わっていないアップロードの件数と、その変化を受け取る関数 */
const pending = new Map<HTMLTextAreaElement, number>();
const pendingListeners = new Map<HTMLTextAreaElement, Set<(n: number) => void>>();

/** textarea に入れている途中のアップロードの件数 */
export function pendingUploads(el: HTMLTextAreaElement): number {
	return pending.get(el) ?? 0;
}

/** textarea のアップロード中の件数が変わったら知らせる。返した関数で解除する */
export function onPendingUploadsChange(
	el: HTMLTextAreaElement,
	cb: (n: number) => void
): () => void {
	let set = pendingListeners.get(el);
	if (!set) pendingListeners.set(el, (set = new Set()));
	set.add(cb);
	return () => {
		set.delete(cb);
		if (set.size === 0) pendingListeners.delete(el);
	};
}

function addPending(el: HTMLTextAreaElement, delta: number) {
	const n = pendingUploads(el) + delta;
	if (n > 0) pending.set(el, n);
	else pending.delete(el);
	for (const cb of pendingListeners.get(el) ?? []) cb(Math.max(n, 0));
}

/** 1 件ずつ順に送る（同名ファイルのプレースホルダが衝突しないように） */
export async function insertUploads(
	el: HTMLTextAreaElement,
	projectKey: string,
	files: Iterable<File>
) {
	const list = Array.from(files);
	if (list.length === 0) return;
	// 全件を先に数える（1 件ごとに 0 に戻ると、その隙にモードを切り替えられる）
	addPending(el, list.length);
	for (const f of list) {
		try {
			await insertUpload(el, projectKey, f);
		} finally {
			addPending(el, -1);
		}
	}
}

/** textarea への貼り付け・ドロップでファイルを添付する。ファイルを含まない操作には何もしない */
export function uploadable(projectKey: string): Attachment<HTMLTextAreaElement> {
	return (el) => {
		const onPaste = (e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []);
			if (!shouldUploadPaste(Array.from(e.clipboardData?.types ?? []), files.length)) return;
			e.preventDefault();
			void insertUploads(el, projectKey, files);
		};
		const onDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
		};
		const onDrop = (e: DragEvent) => {
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length === 0) return;
			e.preventDefault();
			el.focus();
			void insertUploads(el, projectKey, files);
		};
		el.addEventListener('paste', onPaste);
		el.addEventListener('dragover', onDragOver);
		el.addEventListener('drop', onDrop);
		return () => {
			el.removeEventListener('paste', onPaste);
			el.removeEventListener('dragover', onDragOver);
			el.removeEventListener('drop', onDrop);
		};
	};
}
