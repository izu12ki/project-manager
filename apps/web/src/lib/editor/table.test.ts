// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createMarkdownEditor } from './create-editor';
import { tableToMarkdown } from './table';

const md = [
	'| 列1   | 列2   | 列3   |',
	'| ---- | ---- | ---- |',
	'| データ1 | データ2 | データ3 |',
	'| データ4 | データ5 | データ6 |'
].join('\n');

describe('表の表示', () => {
	it('Markdown の表をエディタ上で表として表示し、元の文字列を保つ', () => {
		const root = document.createElement('div');
		root.contentEditable = 'true';
		document.body.appendChild(root);
		const h = createMarkdownEditor({ root });
		h.setMarkdown(md);
		const table = root.querySelector('table');
		expect(table).not.toBeNull();
		expect([...table!.querySelectorAll('th')].map((c) => c.textContent)).toEqual([
			'列1',
			'列2',
			'列3'
		]);
		expect([...table!.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual([
			'データ1データ2データ3',
			'データ4データ5データ6'
		]);
		expect(h.getMarkdown()).toBe(md);
		h.destroy();
	});

	it('列の揃えを表示に反映する', () => {
		const root = document.createElement('div');
		document.body.appendChild(root);
		const h = createMarkdownEditor({ root });
		h.setMarkdown('| a | b |\n| :-: | --: |\n| 1 | 2 |');
		const cells = root.querySelectorAll('td');
		expect((cells[0] as HTMLElement).style.textAlign).toBe('center');
		expect((cells[1] as HTMLElement).style.textAlign).toBe('right');
		h.destroy();
	});
});

describe('tableToMarkdown', () => {
	const parse = (html: string) => {
		const el = document.createElement('div');
		el.innerHTML = html;
		return el.querySelector('table')!;
	};

	it('HTML の表を Markdown の表にする（1 行目を見出しにする）', () => {
		expect(
			tableToMarkdown(
				parse('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>')
			)
		).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
	});

	it('thead があればそれを見出しにする', () => {
		expect(
			tableToMarkdown(
				parse('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>')
			)
		).toBe('| h |\n| --- |\n| x |');
	});

	it('セルの | はエスケープし、改行は空白にし、足りないセルは空で埋める', () => {
		expect(
			tableToMarkdown(
				parse('<table><tr><td>a|b</td><td>c<br>d</td></tr><tr><td>1</td></tr></table>')
			)
		).toBe('| a\\|b | c d |\n| --- | --- |\n| 1 |  |');
	});
});
