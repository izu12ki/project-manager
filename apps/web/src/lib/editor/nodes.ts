import {
	MdastExtension,
	type MdastExportHandler,
	type MdastImportHandler,
	type MdastNode
} from '@lexical/mdast';
import {
	$create,
	$getDocument,
	$getState,
	$setState,
	configExtension,
	createState,
	$isElementNode,
	DecoratorNode,
	defineExtension,
	type DOMExportOutput,
	type LexicalNode
} from 'lexical';
import { $isListNode, ListNode } from '@lexical/list';
import type { Image, List, Table } from 'mdast';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import {
	mentionFromMarkdown,
	mentionToMarkdown,
	type MentionMdast
} from '#lib/markdown/mention-mdast.ts';
import { renderTable, tableToMarkdown } from './table';

/** 表など、エディタでは編集せず元の Markdown をそのまま書き出すブロック */
export interface RawMarkdownMdast {
	type: 'rawMarkdown';
	value: string;
}

declare module 'mdast' {
	interface RootContentMap {
		rawMarkdown: RawMarkdownMdast;
	}
	interface BlockContentMap {
		rawMarkdown: RawMarkdownMdast;
	}
}

const parseString = (v: unknown): string => (typeof v === 'string' ? v : '');

const nameState = createState('name', { parse: parseString });
const userIdState = createState('userId', { parse: parseString });
const srcState = createState('src', { parse: parseString });
const altState = createState('alt', { parse: parseString });
const titleState = createState('title', {
	parse: (v): string | null => (typeof v === 'string' ? v : null)
});
const markdownState = createState('markdown', { parse: parseString });
const uploadKeyState = createState('uploadKey', { parse: parseString });
const filenameState = createState('filename', { parse: parseString });

/* ---------------------------------------------------------------- メンション */

/** `@[表示名](user:<uuid>)`。1 つの塊として扱う inline の要素 */
export class MentionNode extends DecoratorNode<null> {
	$config() {
		return this.config('mention', {
			extends: DecoratorNode,
			stateConfigs: [
				{ flat: true, stateConfig: nameState },
				{ flat: true, stateConfig: userIdState }
			]
		});
	}

	getName(): string {
		return $getState(this, nameState);
	}

	getUserId(): string {
		return $getState(this, userIdState);
	}

	createDOM(): HTMLElement {
		const el = $getDocument().createElement('span');
		el.className = 'mention';
		el.textContent = `@${this.getName()}`;
		return el;
	}

	updateDOM(prev: this, dom: HTMLElement): boolean {
		if (prev.getName() !== this.getName()) dom.textContent = `@${this.getName()}`;
		return false;
	}

	exportDOM(): DOMExportOutput {
		return { element: this.createDOM() };
	}

	getTextContent(): string {
		return `@${this.getName()}`;
	}

	isInline(): true {
		return true;
	}

	decorate(): null {
		return null;
	}
}

export function $createMentionNode(name: string, userId: string): MentionNode {
	const node = $create(MentionNode);
	$setState(node, nameState, name);
	$setState(node, userIdState, userId);
	return node;
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
	return node instanceof MentionNode;
}

/* ---------------------------------------------------------------- 画像 */

/**
 * 添付した画像。`importDOM` は定義しない（外から貼った画像は取り込まない）
 */
export class ImageNode extends DecoratorNode<null> {
	$config() {
		return this.config('md-image', {
			extends: DecoratorNode,
			stateConfigs: [
				{ flat: true, stateConfig: srcState },
				{ flat: true, stateConfig: altState },
				{ flat: true, stateConfig: titleState }
			]
		});
	}

	getSrc(): string {
		return $getState(this, srcState);
	}

	getAlt(): string {
		return $getState(this, altState);
	}

	getTitle(): string | null {
		return $getState(this, titleState);
	}

	createDOM(): HTMLElement {
		const doc = $getDocument();
		const wrap = doc.createElement('span');
		wrap.className = 'md-img';
		const img = doc.createElement('img');
		img.src = this.getSrc();
		img.alt = this.getAlt();
		const title = this.getTitle();
		if (title) img.title = title;
		wrap.appendChild(img);
		return wrap;
	}

	updateDOM(prev: this): boolean {
		return (
			prev.getSrc() !== this.getSrc() ||
			prev.getAlt() !== this.getAlt() ||
			prev.getTitle() !== this.getTitle()
		);
	}

	exportDOM(): DOMExportOutput {
		return { element: this.createDOM() };
	}

	getTextContent(): string {
		return this.getAlt();
	}

	isInline(): true {
		return true;
	}

	decorate(): null {
		return null;
	}
}

export function $createImageNode(src: string, alt: string, title: string | null = null): ImageNode {
	const node = $create(ImageNode);
	$setState(node, srcState, src);
	$setState(node, altState, alt);
	if (title) $setState(node, titleState, title);
	return node;
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
	return node instanceof ImageNode;
}

/* ---------------------------------------------------------------- 表（生の Markdown） */

/**
 * 編集できないブロック。読み込んだ Markdown の文字列をそのまま持ち、そのまま書き出す。
 * 表として表示し、外から貼った HTML の表もこのノードとして取り込む
 */
export class RawMarkdownNode extends DecoratorNode<null> {
	$config() {
		return this.config('raw-markdown', {
			extends: DecoratorNode,
			stateConfigs: [{ flat: true, stateConfig: markdownState }],
			importDOM: {
				table: () => ({
					conversion: (el) => {
						const md = tableToMarkdown(el as HTMLTableElement);
						return { node: md ? $createRawMarkdownNode(md) : null };
					},
					priority: 1
				})
			}
		});
	}

	getMarkdown(): string {
		return $getState(this, markdownState);
	}

	createDOM(): HTMLElement {
		const doc = $getDocument();
		const el = doc.createElement('div');
		el.className = 'raw-md';
		el.title = '表は「Markdown ソースのまま編集」で直せます';
		el.appendChild(renderTable(this.getMarkdown(), doc));
		return el;
	}

	updateDOM(prev: this, dom: HTMLElement): boolean {
		if (prev.getMarkdown() !== this.getMarkdown())
			dom.replaceChildren(renderTable(this.getMarkdown(), $getDocument()));
		return false;
	}

	getTextContent(): string {
		return this.getMarkdown();
	}

	isInline(): false {
		return false;
	}

	decorate(): null {
		return null;
	}
}

export function $createRawMarkdownNode(markdown: string): RawMarkdownNode {
	const node = $create(RawMarkdownNode);
	$setState(node, markdownState, markdown);
	return node;
}

export function $isRawMarkdownNode(node: LexicalNode | null | undefined): node is RawMarkdownNode {
	return node instanceof RawMarkdownNode;
}

/* ---------------------------------------------------------------- アップロード中 */

/** アップロード中の仮の要素。Markdown には書き出さない */
export class UploadPlaceholderNode extends DecoratorNode<null> {
	$config() {
		return this.config('upload-placeholder', {
			extends: DecoratorNode,
			stateConfigs: [
				{ flat: true, stateConfig: uploadKeyState },
				{ flat: true, stateConfig: filenameState }
			]
		});
	}

	getUploadKey(): string {
		return $getState(this, uploadKeyState);
	}

	getFilename(): string {
		return $getState(this, filenameState);
	}

	createDOM(): HTMLElement {
		const el = $getDocument().createElement('span');
		el.className = 'upload-placeholder';
		el.textContent = `アップロード中: ${this.getFilename()}`;
		return el;
	}

	updateDOM(prev: this, dom: HTMLElement): boolean {
		if (prev.getFilename() !== this.getFilename()) {
			dom.textContent = `アップロード中: ${this.getFilename()}`;
		}
		return false;
	}

	getTextContent(): string {
		return '';
	}

	isInline(): true {
		return true;
	}

	decorate(): null {
		return null;
	}
}

export function $createUploadPlaceholderNode(key: string, filename: string): UploadPlaceholderNode {
	const node = $create(UploadPlaceholderNode);
	$setState(node, uploadKeyState, key);
	$setState(node, filenameState, filename);
	return node;
}

export function $isUploadPlaceholderNode(
	node: LexicalNode | null | undefined
): node is UploadPlaceholderNode {
	return node instanceof UploadPlaceholderNode;
}

/* ---------------------------------------------------------------- mdast との変換 */

const $importMention: MdastImportHandler<MentionMdast> = (node) =>
	$createMentionNode(node.name, node.userId);

const $exportMention: MdastExportHandler = (node) =>
	$isMentionNode(node) ? { type: 'mention', name: node.getName(), userId: node.getUserId() } : null;

const $importImage: MdastImportHandler<Image> = (node) =>
	$createImageNode(node.url, node.alt ?? '', node.title ?? null);

const $exportImage: MdastExportHandler = (node) =>
	$isImageNode(node)
		? { type: 'image', url: node.getSrc(), alt: node.getAlt(), title: node.getTitle() }
		: null;

/**
 * 表は、元の文字列をそのまま持たせる。リストや引用の中の表は 2 行目以降に
 * 入れ物の接頭辞（`> ` や字下げ）が付くので、1 行目の開始位置の幅だけ取り除く
 */
function tableSource(node: Table, source: string): string | null {
	const start = node.position?.start;
	const end = node.position?.end.offset;
	if (!source || start?.offset == null || end == null) return null;
	const lines = source.slice(start.offset, end).split('\n');
	const width = start.column - 1;
	const rest = lines.slice(1).map((line) => {
		const prefix = line.slice(0, width);
		return /^[\s>]*$/.test(prefix) ? line.slice(width) : null;
	});
	if (rest.some((line) => line === null)) return null;
	return [lines[0], ...rest].join('\n');
}

const $importTable: MdastImportHandler<Table> = (node, ctx) =>
	$createRawMarkdownNode(
		tableSource(node, ctx.source) ??
			toMarkdown(node, { extensions: [gfmTableToMarkdown()] }).replace(/\n$/, '')
	);

const $exportRawMarkdown: MdastExportHandler = (node) =>
	$isRawMarkdownNode(node) ? { type: 'rawMarkdown', value: node.getMarkdown() } : null;

/**
 * 項目の間に空行がある（loose な）リストは、表示で項目が <p> に包まれる。
 * 標準の規則は空行を落とすので、読み込み時に印を付けて書き出しで戻す
 */
const looseListState = createState('mdLooseList', { parse: (v) => v === true });

const $importLooseList: MdastImportHandler<List> = (node, ctx) => {
	const out = ctx.next();
	if (node.spread || node.children.some((item) => item.spread)) {
		for (const n of out) if ($isListNode(n)) $setState(n, looseListState, true);
	}
	return out;
};

/** 入れ子のリストも含めて、ListNode と mdast の list を出現順（行きがけ順）に集める */
function $collectLists(list: ListNode, out: ListNode[] = []): ListNode[] {
	out.push(list);
	for (const item of list.getChildren()) {
		if (!$isElementNode(item)) continue;
		for (const child of item.getChildren()) if ($isListNode(child)) $collectLists(child, out);
	}
	return out;
}

function collectMdastLists(node: MdastNode, out: List[] = []): List[] {
	if (node.type === 'list') out.push(node);
	if ('children' in node) for (const child of node.children) collectMdastLists(child, out);
	return out;
}

/**
 * 入れ子のリストは標準の規則の中で書き出され、この規則を通らない。
 * そのため一番外のリストで、入れ子も含めて対応する mdast の list に印を戻す
 */
const $exportLooseList: MdastExportHandler = (node, ctx) => {
	const out = ctx.next();
	if (!$isListNode(node)) return out;
	const lexicalLists = $collectLists(node);
	const mdastLists = out.flatMap((n) => collectMdastLists(n));
	if (lexicalLists.length !== mdastLists.length) return out;
	lexicalLists.forEach((list, i) => {
		if (!$getState(list, looseListState)) return;
		const target = mdastLists[i];
		target.spread = true;
		for (const item of target.children) item.spread = true;
	});
	return out;
};

const $exportNothing: MdastExportHandler = () => [];

/** 独自ノードと、その Markdown の読み書きの規則 */
export const MarkdownNodesExtension = defineExtension({
	name: 'project-manager/markdown-nodes',
	nodes: [MentionNode, ImageNode, RawMarkdownNode, UploadPlaceholderNode],
	dependencies: [
		configExtension(MdastExtension, {
			importRules: [
				{ type: 'mention', $import: $importMention },
				{ type: 'image', $import: $importImage },
				{ type: 'table', $import: $importTable },
				{ type: 'list', $import: $importLooseList }
			],
			exportRules: [
				{ type: MentionNode, $export: $exportMention },
				{ type: ImageNode, $export: $exportImage },
				{ type: RawMarkdownNode, $export: $exportRawMarkdown },
				{ type: UploadPlaceholderNode, $export: $exportNothing },
				{ type: ListNode, $export: $exportLooseList }
			],
			micromarkExtensions: [gfmTable()],
			mdastExtensions: [gfmTableFromMarkdown(), mentionFromMarkdown()],
			toMarkdownExtensions: [
				mentionToMarkdown(),
				{
					handlers: {
						rawMarkdown: (node: RawMarkdownMdast) => node.value
					}
				}
			]
		})
	]
});
