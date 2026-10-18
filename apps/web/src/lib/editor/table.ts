import type { Nodes, Table } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';

/** セルの文字（書式は付けずに文字だけ。編集できない表の表示用） */
function textOf(node: Nodes): string {
	if ('value' in node && typeof node.value === 'string') return node.value;
	if (node.type === 'break') return ' ';
	return 'children' in node ? node.children.map((c) => textOf(c as Nodes)).join('') : '';
}

/**
 * Markdown の表をエディタ上に表として表示する要素を作る。
 * 表として読めなければ元の文字列をそのまま出す
 */
export function renderTable(markdown: string, doc: Document): HTMLElement {
	const tree = fromMarkdown(markdown, {
		extensions: [gfmTable()],
		mdastExtensions: [gfmTableFromMarkdown()]
	});
	const table = tree.children.find((n): n is Table => n.type === 'table');
	if (!table) {
		const pre = doc.createElement('pre');
		pre.textContent = markdown;
		return pre;
	}
	const el = doc.createElement('table');
	const [head, ...body] = table.children;
	const section = (tag: 'thead' | 'tbody', rows: Table['children'], cell: 'th' | 'td') => {
		const s = doc.createElement(tag);
		for (const row of rows) {
			const tr = doc.createElement('tr');
			row.children.forEach((c, i) => {
				const td = doc.createElement(cell);
				const align = table.align?.[i];
				if (align) td.style.textAlign = align;
				td.textContent = textOf(c);
				tr.appendChild(td);
			});
			s.appendChild(tr);
		}
		el.appendChild(s);
	};
	if (head) section('thead', [head], 'th');
	if (body.length > 0) section('tbody', body, 'td');
	return el;
}

/** セルの文字。<br> は改行として数える */
function cellText(cell: Element): string {
	const copy = cell.cloneNode(true) as Element;
	copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
	return copy.textContent ?? '';
}

/** 貼り付けた HTML の表を Markdown の表にする。thead がなければ 1 行目を見出しにする */
export function tableToMarkdown(table: HTMLTableElement): string {
	const rows = Array.from(table.rows, (tr) =>
		Array.from(tr.cells, (c) =>
			cellText(c)
				.replace(/\s*\n\s*/g, ' ')
				.trim()
				.replace(/\|/g, '\\|')
		)
	);
	if (rows.length === 0) return '';
	const width = Math.max(...rows.map((r) => r.length));
	const line = (r: string[]) =>
		`| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
	const [head, ...body] = rows;
	return [line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}
