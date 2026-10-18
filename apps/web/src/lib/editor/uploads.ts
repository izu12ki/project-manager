import { $createLinkNode } from '@lexical/link';
import { DRAG_DROP_PASTE } from '@lexical/rich-text';
import { $dfs, mergeRegister } from '@lexical/utils';
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isLineBreakNode,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	DRAGOVER_COMMAND,
	HISTORY_MERGE_TAG,
	PASTE_COMMAND,
	type LexicalEditor,
	type RangeSelection
} from 'lexical';
import { shouldUploadPaste } from '$lib/attachment-rules';
import { trackUpload, uploadFile, type UploadResult } from '$lib/attachment-upload';
import { toast } from '$lib/toast.svelte';
import {
	$createImageNode,
	$createUploadPlaceholderNode,
	$isUploadPlaceholderNode,
	UploadPlaceholderNode
} from './nodes';

/** キャレットが行の先頭（ブロックの先頭か改行の直後）にあるか */
function $atLineStart(sel: RangeSelection): boolean {
	const { anchor } = sel;
	let node = anchor.getNode();
	if (anchor.type === 'text') {
		if (anchor.offset > 0) return false;
	} else if ($isElementNode(node)) {
		if (anchor.offset > 0) return $isLineBreakNode(node.getChildAtIndex(anchor.offset - 1));
		if (!node.isInline()) return true;
	}
	for (;;) {
		const prev = node.getPreviousSibling();
		if (prev) return $isLineBreakNode(prev);
		const parent = node.getParent();
		if (!parent || !parent.isInline()) return true;
		node = parent;
	}
}

/** 選択がなければ（一度も触っていないなど）末尾の行に置く */
function $selectionForInsert(): RangeSelection {
	const sel = $getSelection();
	if ($isRangeSelection(sel)) return sel;
	const root = $getRoot();
	const last = root.getLastChild();
	if ($isParagraphNode(last) && last.isEmpty()) last.select();
	else {
		const p = $createParagraphNode();
		root.append(p);
		p.select();
	}
	return $getSelection() as RangeSelection;
}

/**
 * 仮の要素をキャレット位置に入れる。今の textarea 版と同じく、添付は 1 行に 1 つ置く
 * （行の途中なら前で改行する）
 */
function $insertPlaceholders(items: { key: string; filename: string }[]) {
	for (const { key, filename } of items) {
		const sel = $selectionForInsert();
		const nodes = $atLineStart(sel) ? [] : [$createLineBreakNode()];
		sel.insertNodes([...nodes, $createUploadPlaceholderNode(key, filename)]);
	}
}

function $findPlaceholder(key: string): UploadPlaceholderNode | null {
	for (const { node } of $dfs()) {
		if ($isUploadPlaceholderNode(node) && node.getUploadKey() === key) return node;
	}
	return null;
}

/** 仮の要素を結果（画像かリンク）に置き換える。失敗なら消す。ユーザーが消していたら何もしない */
function settle(editor: LexicalEditor, key: string, result: UploadResult | null) {
	editor.update(
		() => {
			const ph = $findPlaceholder(key);
			if (!ph) return;
			if (!result) return void ph.remove();
			const { url, filename, isImage } = result;
			ph.replace(
				isImage
					? $createImageNode(url, filename)
					: $createLinkNode(url).append($createTextNode(filename))
			);
		},
		// 取り消しで「アップロード中」に戻らないよう、直前の履歴にまとめる
		{ tag: HISTORY_MERGE_TAG }
	);
}

/**
 * ファイルをキャレット位置にアップロードする。仮の要素をまとめて入れてから 1 件ずつ順に送り、
 * 終わるまで form の送信を止める
 */
export async function insertUploadsIntoEditor(
	editor: LexicalEditor,
	form: HTMLFormElement | null,
	projectKey: string,
	files: Iterable<File>,
	upload: typeof uploadFile = uploadFile
): Promise<void> {
	const items = Array.from(files, (file) => ({
		file,
		key: crypto.randomUUID(),
		filename: file.name
	}));
	if (items.length === 0) return;
	editor.update(() => $insertPlaceholders(items));
	const done = trackUpload(form);
	try {
		for (const { file, key } of items) {
			let result: UploadResult | null = null;
			try {
				result = await upload(projectKey, file);
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました');
			}
			settle(editor, key, result);
		}
	} finally {
		done();
	}
}

/**
 * 見たまま編集のモードでの貼り付け・ドロップを添付にする。ドロップは rich-text が
 * ドロップ位置に選択を移してから DRAG_DROP_PASTE を出すので、それを受ける
 */
export function registerEditorUploads(
	editor: LexicalEditor,
	opts: {
		projectKey: string;
		form: () => HTMLFormElement | null;
		/** 仮の要素がある間 true（モードの切り替えを止めるため） */
		onUploadingChange?: (uploading: boolean) => void;
		upload?: typeof uploadFile;
	}
): () => void {
	const start = (files: File[]) =>
		void insertUploadsIntoEditor(editor, opts.form(), opts.projectKey, files, opts.upload);
	const pending = new Set<string>();
	return mergeRegister(
		// rich-text より先に、textarea 版と同じ条件（テキストを含まない）で判定する
		editor.registerCommand(
			PASTE_COMMAND,
			(e) => {
				const data = 'clipboardData' in e ? e.clipboardData : null;
				const files = Array.from(data?.files ?? []);
				if (!shouldUploadPaste(Array.from(data?.types ?? []), files.length)) return false;
				e.preventDefault();
				start(files);
				return true;
			},
			COMMAND_PRIORITY_LOW
		),
		editor.registerCommand(
			DRAG_DROP_PASTE,
			(files) => {
				start(files);
				return true;
			},
			COMMAND_PRIORITY_LOW
		),
		// ファイルのドロップを受け付ける（受けないとブラウザがファイルを開いてしまう）
		editor.registerCommand(
			DRAGOVER_COMMAND,
			(e) => {
				if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
				return false;
			},
			COMMAND_PRIORITY_LOW
		),
		editor.registerMutationListener(
			UploadPlaceholderNode,
			(mutations) => {
				const was = pending.size > 0;
				for (const [key, m] of mutations) {
					if (m === 'destroyed') pending.delete(key);
					else pending.add(key);
				}
				if (was !== pending.size > 0) opts.onUploadingChange?.(pending.size > 0);
			},
			{ skipInitialization: true }
		)
	);
}
