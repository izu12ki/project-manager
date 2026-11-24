// Backlog 記法（Backlog のプロジェクト設定「テキスト整形のルール」が Backlog 記法のときの書き方）を
// Markdown に変換する。課題 CSV の詳細・コメントは書かれたままの記法で出てくる。
// 記法は Backlog のヘルプ（テキスト整形のルール: Backlog 記法）に沿う。行単位の記法なので、行ごとに読む。
// ブラウザで使う（$lib/server を import しない）。
import type { BacklogIssueRow } from '#lib/backlog-issues.ts';

/** Markdown で書式になる記号。Backlog 記法では文字なので、エスケープして文字のまま残す */
const MARKDOWN_SPECIAL = /[*_`~]/g;
const escapeText = (s: string) => s.replace(MARKDOWN_SPECIAL, '\\$&');

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const URL = /^(?:https?|ftp):\/\/\S+$/;
/** [[ラベル>URL]] / [[ラベル:URL]]。ラベルの : は区切りにしないよう、URL の始まりで分ける */
const LABELED_LINK = /^(.*?)[>:]((?:https?|ftp):\/\/\S+)$/;

const destination = (url: string) => (/[\s()<>]/.test(url) ? `<${url}>` : url);

/** [[…]] の中身 */
function bracketLink(inner: string): string {
	const labeled = inner.match(LABELED_LINK);
	if (labeled) {
		const label = labeled[1].trim();
		const url = labeled[2];
		if (label === '') return url;
		return `[${inline(label).replace(/[[\]]/g, '\\$&')}](${destination(url)})`;
	}
	// URL だけ・課題キーだけはそのまま（URL と課題キーは表示のときにリンクになる）
	if (URL.test(inner) || ISSUE_KEY.test(inner)) return inner;
	// Wiki のページへのリンク。ページは移行しないので、書かれたまま残す
	return `\\[\\[${escapeText(inner)}\\]\\]`;
}

/** 端に出しても書式の意味が変わらない文字（約物・記号・空白）。Backlog 記法の記号は除く */
const isEdge = (ch: string) => /[\p{P}\p{S}\s]/u.test(ch) && !"'%&[]\\{}#".includes(ch);

/**
 * 装飾の記号で囲む。中身の端の約物と空白は外に出す。CommonMark では「**「重要」**です」のように
 * 約物の内側で閉じて文字が続くと装飾にならないため（外に出すと、括弧が太字にならないだけで同じに見える）
 */
function wrap(mark: string, raw: string): string {
	const chars = [...raw];
	let start = 0;
	let end = chars.length;
	while (start < end && isEdge(chars[start])) start += 1;
	while (end > start && isEdge(chars[end - 1])) end -= 1;
	if (start === end) return `${mark}${inline(raw)}${mark}`;
	const outside = (from: number, to: number) => escapeText(chars.slice(from, to).join(''));
	return `${outside(0, start)}${mark}${inline(chars.slice(start, end).join(''))}${mark}${outside(end, chars.length)}`;
}

/** 行の中の記法。順に試し、最初に当たったものを使う。&br; は '\n' にする（呼び出し側で行に分ける） */
const INLINE: [RegExp, (m: RegExpExecArray) => string][] = [
	// \ の後の文字は Backlog でも Markdown でもそのままの文字になる
	[/\\[\s\S]/y, (m) => m[0]],
	[/'''(.+?)'''/y, (m) => wrap('*', m[1])],
	[/''(.+?)''/y, (m) => wrap('**', m[1])],
	[/%%(.+?)%%/y, (m) => wrap('~~', m[1])],
	[/&color\([^)]*\)\s*\{\s*(.*?)\s*\}/y, (m) => inline(m[1])],
	[/&br;/y, () => '\n'],
	[/\[\[(.+?)\]\]/y, (m) => bracketLink(m[1])],
	[/#(?:image|thumbnail)\(([^)]*)\)/y, (m) => `（画像: ${escapeText(m[1].trim())}）`],
	[/#attach\(([^)]*)\)/y, (m) => `（添付: ${escapeText(m[1].split(':')[0].trim())}）`],
	[/#rev\((\d+)\)/y, (m) => `r${m[1]}`]
];
/** INLINE のどれかが始まりうる文字。それ以外の文字では試さない */
const INLINE_START = new Set(['\\', "'", '%', '&', '[', '#']);

function inline(s: string): string {
	let out = '';
	let text = '';
	let i = 0;
	outer: while (i < s.length) {
		if (INLINE_START.has(s[i])) {
			for (const [re, fn] of INLINE) {
				re.lastIndex = i;
				const m = re.exec(s);
				if (m) {
					out += escapeText(text) + fn(m);
					text = '';
					i += m[0].length;
					continue outer;
				}
			}
		}
		text += s[i];
		i += 1;
	}
	return out + escapeText(text);
}

/** 行頭が Markdown では別の意味になる文字（見出し・リスト・引用・区切り）なら、文字のまま残す */
function escapeLineStart(line: string): string {
	if (/^(?:#{1,6}(?:\s|$)|[-+>])/.test(line)) return `\\${line}`;
	if (/^=+\s*$/.test(line)) return `\\${line}`;
	return line.replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');
}

/** 行の中身を変換し、&br; の改行の後の行も文字のまま残す */
const inlineLines = (s: string) => inline(s).split('\n').map(escapeLineStart);
const inlineOneLine = (s: string) => inline(s).replace(/\n/g, ' ').trim();

type Kind = 'blank' | 'para' | 'heading' | 'list' | 'quote' | 'table' | 'code';

class Output {
	lines: string[] = [];
	private last: Kind = 'blank';

	push(kind: Kind, ...lines: string[]) {
		// リスト・引用・表は、前後の別の種類の行を続きとして取り込まないよう空行で分ける
		const separate = (k: Kind) => k === 'list' || k === 'quote' || k === 'table';
		if (
			kind !== 'blank' &&
			this.last !== 'blank' &&
			kind !== this.last &&
			(separate(kind) || separate(this.last))
		) {
			this.lines.push('');
		}
		this.lines.push(...lines);
		this.last = kind;
	}
}

const LIST_WIDTH = { '-': 2, '+': 3 } as const;
const LIST_MARK = { '-': '- ', '+': '1. ' } as const;

/** 表の 1 行。null は表の行ではない */
function tableRow(line: string): { cells: string[]; header: boolean } | null {
	const m = line.match(/^\|(.*)\|(h?)\s*$/);
	if (!m) return null;
	return { cells: m[1].split('|'), header: m[2] === 'h' };
}

function tableLines(rows: { cells: string[]; header: boolean }[]): string[] {
	const width = Math.max(...rows.map((r) => r.cells.length));
	const cell = (c: string, bold: boolean) => {
		const header = c.startsWith('~');
		const text = inlineOneLine(header ? c.slice(1) : c);
		return (bold || header) && text !== '' ? `**${text}**` : text;
	};
	const line = (r: { cells: string[]; header: boolean }, i: number) => {
		// 見出し行は先頭だけ Markdown の見出しにでき、2 行目以降の見出し行は太字にする
		const cells = r.cells.map((c) => cell(c, r.header && i > 0));
		return `| ${Array.from({ length: width }, (_, j) => cells[j] ?? '').join(' | ')} |`;
	};
	// 見出し行がなければ 1 行目を見出しにする（貼り付けた表と同じ）
	const [head, ...body] = rows.map(line);
	return [head, `| ${Array(width).fill('---').join(' | ')} |`, ...body];
}

/** {tag}…{/tag} の中身の行を集める。閉じていなければ最後まで。rest は閉じた後に同じ行に続く文字 */
function block(
	lines: string[],
	start: number,
	open: RegExp,
	close: string
): { tag: RegExpMatchArray; body: string[]; next: number; rest: string } {
	const tag = lines[start].match(open)!;
	const body: string[] = [];
	for (let i = start; i < lines.length; i++) {
		const line = i === start ? lines[i].slice(tag[0].length) : lines[i];
		const at = line.indexOf(close);
		const content = at >= 0 ? line.slice(0, at) : line;
		// 開く行と閉じる行は、記号の他に文字があるときだけ中身にする
		if (content !== '' || (i > start && at < 0)) body.push(content);
		if (at >= 0) return { tag, body, next: i + 1, rest: line.slice(at + close.length) };
	}
	return { tag, body, next: lines.length, rest: '' };
}

const CODE_OPEN = /^\{code(?::([^}]*))?\}/;
const QUOTE_OPEN = /^\{quote\}/;

function convertLines(lines: string[]): string[] {
	const out = new Output();
	/** 入れ子の深さごとの記号（字下げの幅を決める） */
	let listMarks: ('-' | '+')[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!/^[-+]/.test(line)) listMarks = [];

		if (CODE_OPEN.test(line)) {
			const b = block(lines, i, CODE_OPEN, '{/code}');
			const runs = b.body.flatMap((l) => l.match(/`+/g) ?? []).map((x) => x.length);
			const fence = '`'.repeat(Math.max(3, ...runs.map((n) => n + 1)));
			const lang = (b.tag[1] ?? '').trim().replace(/[^\w+#.-]/g, '');
			out.push('code', `${fence}${lang}`, ...b.body, fence);
			// {/code} の後に続く文字は次の行として読む
			if (b.rest.trim() !== '') lines.splice(b.next, 0, b.rest);
			i = b.next - 1;
			continue;
		}
		if (QUOTE_OPEN.test(line)) {
			const b = block(lines, i, QUOTE_OPEN, '{/quote}');
			const inner = convertLines(b.body);
			if (inner.length > 0) out.push('quote', ...inner.map((l) => (l === '' ? '>' : `> ${l}`)));
			if (b.rest.trim() !== '') lines.splice(b.next, 0, b.rest);
			i = b.next - 1;
			continue;
		}
		if (line.trim() === '') {
			out.push('blank', '');
			continue;
		}
		if (line.trim() === '#contents') continue;

		const heading = line.match(/^(\*{1,6})(?!\*)\s*(.*)$/);
		if (heading && heading[2].trim() !== '') {
			out.push('heading', `${'#'.repeat(heading[1].length)} ${inlineOneLine(heading[2])}`);
			continue;
		}
		const item = line.match(/^(-{1,3}|\+{1,3})(?![-+])\s*(.*)$/);
		if (item && item[2].trim() !== '') {
			const mark = item[1][0] as '-' | '+';
			const depth = item[1].length;
			const indent = Array.from(
				{ length: depth - 1 },
				(_, d) => LIST_WIDTH[listMarks[d] ?? '-']
			).reduce((a, b) => a + b, 0);
			listMarks = [...listMarks.slice(0, depth - 1), mark];
			const pad = ' '.repeat(indent);
			// チェックリスト（- [ ] / - [x]）は GFM のタスクリストと同じ書き方なので、そのまま使える
			const [first, ...rest] = inlineLines(item[2].trim());
			const cont = ' '.repeat(indent + LIST_WIDTH[mark]);
			out.push('list', `${pad}${LIST_MARK[mark]}${first}`, ...rest.map((l) => cont + l));
			continue;
		}
		const quote = line.match(/^(>{1,3})\s*(.*)$/);
		if (quote) {
			const prefix = Array(quote[1].length).fill('>').join(' ');
			out.push(
				'quote',
				...inlineLines(quote[2]).map((l) => (l === '' ? prefix : `${prefix} ${l}`))
			);
			continue;
		}
		if (tableRow(line)) {
			const rows = [];
			while (i < lines.length && tableRow(lines[i])) {
				rows.push(tableRow(lines[i])!);
				i += 1;
			}
			i -= 1;
			out.push('table', ...tableLines(rows));
			continue;
		}
		// 段落。行頭の半角空白は表示されないので外す（4 つ以上でコードブロックにならないように）
		out.push('para', ...inlineLines(line.replace(/^[ \t]+/, '')));
	}
	return out.lines;
}

/** Backlog 記法の文章を Markdown にする */
export function backlogToMarkdown(text: string): string {
	return convertLines(text.replace(/\r\n?/g, '\n').split('\n')).join('\n');
}

/** Backlog 記法でしか使わない書き方。Markdown の文章にはまず出てこないものだけを見る */
const SIGNALS = [
	/''[^'\n]+''/,
	/%%[^%\n]+%%/,
	/&br;/,
	/&color\(/,
	/\[\[[^\]\n]*?[>:](?:https?|ftp):\/\/[^\]\s]+\]\]/,
	/\[\[[A-Z][A-Z0-9_]*-\d+\]\]/,
	/^\{code(?::[^}]*)?\}|\{\/code\}/m,
	/^\{quote\}|\{\/quote\}/m,
	/^#contents\s*$/m,
	/#(?:image|thumbnail|attach|rev)\(/,
	/^\|.*\|h\s*$/m,
	// 入れ子の箇条書き（- の次の行が --）
	/^-[^-\n].*\n--[^-\n]/m
];

/** Backlog 記法で書かれているようなら true。Markdown のコード（``` と `）の中は見ない */
export function hasBacklogNotation(text: string): boolean {
	const prose = text
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
		.replace(/`[^`\n]*`/g, '');
	return SIGNALS.some((re) => re.test(prose));
}

/** 本文かコメントが Backlog 記法で書かれているような課題のキー（CSV の順） */
export function keysWithBacklogNotation(rows: BacklogIssueRow[]): string[] {
	return rows
		.filter(
			(r) => hasBacklogNotation(r.description) || r.comments.some((c) => hasBacklogNotation(c.body))
		)
		.map((r) => r.key);
}

/** 全行の本文とコメントを Markdown にした写し */
export function convertBacklogRows(rows: BacklogIssueRow[]): BacklogIssueRow[] {
	return rows.map((r) => ({
		...r,
		description: backlogToMarkdown(r.description),
		comments: r.comments.map((c) => ({ ...c, body: backlogToMarkdown(c.body) }))
	}));
}
