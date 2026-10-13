import type { Attachment } from 'svelte/attachments';
import { MAX_ATTACHMENT_BYTES, TOO_LARGE_MESSAGE, markdownFor } from './attachment-rules';
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

/** カーソル位置にプレースホルダを入れてアップロードし、終わったらリンクに置き換える（失敗時は消す） */
async function insertUpload(el: HTMLTextAreaElement, projectKey: string, file: File) {
	const placeholder = `![アップロード中: ${file.name.replace(/[[\]]/g, '')}]()`;
	el.setRangeText(placeholder, el.selectionStart, el.selectionEnd, 'end');
	notify(el);
	let replacement = '';
	try {
		replacement = markdownFor(await uploadFile(projectKey, file));
	} catch (e) {
		toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました');
	}
	const i = el.value.indexOf(placeholder);
	if (i === -1) return; // アップロード中にユーザーがプレースホルダを消した
	el.setRangeText(replacement, i, i + placeholder.length, 'preserve');
	notify(el);
}

/** 1 件ずつ順に送る（同名ファイルのプレースホルダが衝突しないように） */
export async function insertUploads(
	el: HTMLTextAreaElement,
	projectKey: string,
	files: Iterable<File>
) {
	for (const f of files) await insertUpload(el, projectKey, f);
}

/** textarea への貼り付け・ドロップでファイルを添付する。ファイルを含まない操作には何もしない */
export function uploadable(projectKey: string): Attachment<HTMLTextAreaElement> {
	return (el) => {
		const onPaste = (e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []);
			if (files.length === 0) return;
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
