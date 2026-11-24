import { describe, expect, it } from 'vitest';
import {
	backlogToMarkdown,
	convertBacklogRows,
	hasBacklogNotation,
	keysWithBacklogNotation
} from '#lib/backlog-notation.ts';
import type { BacklogIssueRow } from '#lib/backlog-issues.ts';

const md = (...lines: string[]) => backlogToMarkdown(lines.join('\n'));
const out = (...lines: string[]) => lines.join('\n');

describe('backlogToMarkdown: 文字の装飾', () => {
	it('太字・斜体・打ち消し線', () => {
		expect(md("''太字''と'''斜体'''と%%打ち消し%%")).toBe('**太字**と*斜体*と~~打ち消し~~');
	});

	it('装飾の中の装飾も変換する', () => {
		expect(md("''太字の中の%%打ち消し%%''")).toBe('**太字の中の~~打ち消し~~**');
	});

	it('端の約物と空白は記号の外に出す（CommonMark で装飾になるように）', () => {
		expect(md("''「重要」''です。'' 注 ''と%%（旧）%%")).toBe(
			'「**重要**」です。 **注** と（~~旧~~）'
		);
	});

	it('約物だけなら外に出さない', () => {
		expect(md("''！''")).toBe('**！**');
	});

	it('色は外して文字だけ残す', () => {
		expect(md('&color(red) { 赤 }と&color(#ffffff, #8abe00) { 背景色 }')).toBe('赤と背景色');
	});

	it('閉じていない記号はそのまま', () => {
		expect(md("''だけ")).toBe("''だけ");
	});

	it('Markdown の記号は文字として残す', () => {
		expect(md('__init__.py と *注* と `x` と 1~2')).toBe(
			'\\_\\_init\\_\\_.py と \\*注\\* と \\`x\\` と 1\\~2'
		);
	});

	it('バックスラッシュのエスケープはそのまま（Markdown でも同じ意味）', () => {
		expect(md("\\''太字にしない\\''")).toBe("\\''太字にしない\\''");
	});
});

describe('backlogToMarkdown: リンク', () => {
	it('[[ラベル>URL]] と [[ラベル:URL]] を Markdown のリンクにする', () => {
		expect(md('[[Backlog>https://backlog.com/ja/]] [[Backlog:https://backlog.com/ja/]]')).toBe(
			'[Backlog](https://backlog.com/ja/) [Backlog](https://backlog.com/ja/)'
		);
	});

	it('ラベルの : は区切りにしない', () => {
		expect(md('[[手順: 1:https://example.com/a]]')).toBe('[手順: 1](https://example.com/a)');
	});

	it('括弧や空白を含む URL は <> で囲む', () => {
		expect(md('[[説明>https://example.com/a_(b)]]')).toBe('[説明](<https://example.com/a_(b)>)');
	});

	it('[[URL]] は URL だけにする', () => {
		expect(md('[[https://example.com/]]')).toBe('https://example.com/');
	});

	it('[[課題キー]] はキーだけにする（このツールがリンクにする）', () => {
		expect(md('[[BLG-104]] を参照')).toBe('BLG-104 を参照');
	});

	it('Wiki のページ名は書かれたまま', () => {
		expect(md('[[議事録]]')).toBe('\\[\\[議事録\\]\\]');
	});
});

describe('backlogToMarkdown: 見出し・箇条書き', () => {
	it('* の数を見出しのレベルにする', () => {
		expect(md('* 見出し1', '** 見出し2', '***見出し3')).toBe(
			out('# 見出し1', '## 見出し2', '### 見出し3')
		);
	});

	it('- と + の箇条書きを入れ子の深さに合わせて字下げする', () => {
		expect(md('- 項目', '-- 子', '--- 孫', '+ 番号', '++ 番号の子', '-- 番号の下の箇条書き')).toBe(
			out('- 項目', '  - 子', '    - 孫', '1. 番号', '   1. 番号の子', '   - 番号の下の箇条書き')
		);
	});

	it('チェックリストはそのまま GFM のタスクリストになる', () => {
		expect(md('- [ ] Item-A', '- [x] Item-B', '-- [ ] Item-B-1')).toBe(
			out('- [ ] Item-A', '- [x] Item-B', '  - [ ] Item-B-1')
		);
	});

	it('箇条書きの後の段落は空行で分ける（項目の続きにしない）', () => {
		expect(md('- 項目', '段落')).toBe(out('- 項目', '', '段落'));
	});

	it('記号だけの行は区切り線として文字のまま残す', () => {
		expect(md('前', '----------', '後')).toBe(out('前', '\\----------', '後'));
	});
});

describe('backlogToMarkdown: 引用・コード', () => {
	it('> の引用と {quote}', () => {
		expect(md('>引用です', '{quote}', "''太字''", '{/quote}', '後')).toBe(
			out('> 引用です', '> **太字**', '', '後')
		);
	});

	it('{code} の中は変換しない', () => {
		expect(md('{code:java}', "String s = ''x'';", '{/code}', "''後''")).toBe(
			out('```java', "String s = ''x'';", '```', '**後**')
		);
	});

	it('1 行の {code}…{/code}', () => {
		expect(md('{code}a_b{/code}')).toBe(out('```', 'a_b', '```'));
	});

	it('中にバッククォートが 3 つ並ぶときはフェンスを長くする', () => {
		expect(md('{code}', '```', '{/code}')).toBe(out('````', '```', '````'));
	});

	it('閉じていない {code} は最後までコード', () => {
		expect(md('{code}', "''x''")).toBe(out('```', "''x''", '```'));
	});
});

describe('backlogToMarkdown: 表', () => {
	it('h で終わる行を見出し行にする', () => {
		expect(md('|名前|値|h', "|a|''b''|", '|c|d|')).toBe(
			out('| 名前 | 値 |', '| --- | --- |', '| a | **b** |', '| c | d |')
		);
	});

	it('見出し行がなければ 1 行目を見出しにする（貼り付けた表と同じ）', () => {
		expect(md('|a|b|', '|c|d|')).toBe(out('| a | b |', '| --- | --- |', '| c | d |'));
	});

	it('~ で始まるセルと 2 行目以降の見出し行は太字にし、列数をそろえる', () => {
		expect(md('|~項目|値|', '|合計|1|2|h')).toBe(
			out('| **項目** | 値 |  |', '| --- | --- | --- |', '| **合計** | **1** | **2** |')
		);
	});

	it('表の前後は空行で分ける', () => {
		expect(md('前', '|a|', '後')).toBe(out('前', '', '| a |', '| --- |', '', '後'));
	});
});

describe('backlogToMarkdown: 改行・その他', () => {
	it('&br; は改行にする。見出しと表の中では空白にする', () => {
		expect(md('a&br;b', '- c&br;d', '* e&br;f', '|g&br;h|')).toBe(
			out('a', 'b', '', '- c', '  d', '', '# e f', '', '| g h |', '| --- |')
		);
	});

	it('改行の後の行頭の記号も文字のまま', () => {
		expect(md('a&br;- b&br;# c')).toBe(out('a', '\\- b', '\\# c'));
	});

	it('Markdown で別の意味になる行頭を文字のまま残す', () => {
		expect(md('# 番号', '1. 手順', '見出しではない', '===')).toBe(
			out('\\# 番号', '1\\. 手順', '見出しではない', '\\===')
		);
	});

	it('#contents は消し、画像・添付・リビジョンは文字にする', () => {
		expect(md('#contents', '#image(a.png) #thumbnail(b.png) #attach(資料:c.pdf) #rev(11)')).toBe(
			'（画像: a.png） （画像: b.png） （添付: 資料） r11'
		);
	});

	it('行頭の半角空白は外す（字下げのコードにしない）', () => {
		expect(md('前', '', '    字下げ')).toBe(out('前', '', '字下げ'));
	});

	it('Backlog 記法がなければ、記号のエスケープ以外は変えない', () => {
		expect(md('一行目', '二行目', '', '三行目')).toBe(out('一行目', '二行目', '', '三行目'));
	});
});

describe('hasBacklogNotation', () => {
	it.each([
		["''太字''"],
		['%%打ち消し%%'],
		['a&br;b'],
		['&color(red) { 赤 }'],
		['[[Backlog>https://backlog.com/]]'],
		['[[BLG-1]]'],
		['{code}\nx\n{/code}'],
		['{quote}\nx\n{/quote}'],
		['#contents'],
		['#image(a.png)'],
		['|a|b|h'],
		['- 親\n-- 子']
	])('%s は Backlog 記法', (text) => {
		expect(hasBacklogNotation(text)).toBe(true);
	});

	it.each([
		['# 見出し\n\n- 項目\n  - 子\n\n**太字** ~~打ち消し~~'],
		['[リンク](https://example.com/)'],
		['| a | b |\n| --- | --- |'],
		["```\nx = '' if y else ''\n```"],
		["`'' + ''`"],
		['* 箇条書き\n+ 箇条書き']
	])('%s は Markdown として読む', (text) => {
		expect(hasBacklogNotation(text)).toBe(false);
	});
});

const row = (key: string, description: string, comments: string[] = []) =>
	({
		key,
		description,
		comments: comments.map((body) => ({ at: null, author: '', body }))
	}) as unknown as BacklogIssueRow;

describe('keysWithBacklogNotation / convertBacklogRows', () => {
	const rows = [
		row('A-1', "''太字''"),
		row('A-2', '普通の本文', ['%%打ち消し%%']),
		row('A-3', '普通の本文', ['普通のコメント'])
	];

	it('本文かコメントに Backlog 記法がある課題のキー', () => {
		expect(keysWithBacklogNotation(rows)).toEqual(['A-1', 'A-2']);
	});

	it('本文とコメントを変換する（元の行は変えない）', () => {
		const converted = convertBacklogRows(rows);
		expect(converted.map((r) => r.description)).toEqual(['**太字**', '普通の本文', '普通の本文']);
		expect(converted[1].comments[0].body).toBe('~~打ち消し~~');
		expect(rows[0].description).toBe("''太字''");
	});
});
