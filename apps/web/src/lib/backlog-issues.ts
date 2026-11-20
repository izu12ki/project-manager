// Backlog の課題 CSV の読み込み。ブラウザとサーバーの両方で使う（$lib/server を import しない）。
// 日時はタイムゾーンが書かれていないので、読み込む人の環境（ブラウザ）のタイムゾーンで解釈する。
import { columnIndex, parseCsv, restoreNewlines } from '#lib/csv.ts';

export const MAX_IMPORT_ISSUES = 500;
export const MAX_IMPORT_COMMENTS = 5000;
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export interface BacklogComment {
	/** epoch ミリ秒。日時が読めなければ null */
	at: number | null;
	author: string;
	body: string;
}

export interface BacklogIssueRow {
	/** ヘッダーを 1 とした行番号 */
	rowNumber: number;
	/** 大文字にしたもの */
	key: string;
	/** 「キーID」。空・不正ならキーの末尾の番号、それもなければ null */
	keyId: number | null;
	type: string;
	categories: string[];
	milestones: string[];
	version: string;
	title: string;
	description: string;
	status: string;
	priority: string;
	resolution: string;
	assignee: string;
	reporter: string;
	/** 大文字にしたもの */
	parentKey: string;
	createdAt: number | null;
	updatedAt: number | null;
	/** 'YYYY-MM-DD'。空は ''。形の違う値はそのまま（サーバーが行のエラーにする） */
	startDate: string;
	dueDate: string;
	estimatedHours: string;
	actualHours: string;
	/** 「添付」の件数 */
	attachments: number;
	/** 古い順。本文が空のコメントは除く */
	comments: BacklogComment[];
}

const REQUIRED = ['キー', '件名', '詳細', '状態', '登録者', '登録日'] as const;
const OPTIONAL = [
	'キーID',
	'種別',
	'カテゴリー名',
	'発生バージョン',
	'優先度',
	'マイルストーン',
	'完了理由',
	'担当者',
	'親課題キー',
	'開始日',
	'期限日',
	'予定時間',
	'実績時間',
	'更新日',
	'添付'
] as const;
type Column = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];

/** 空白（全角・半角、前後と途中）をすべて除く。人の名前の突き合わせに使う */
export function personKey(name: string): string {
	return name.replace(/\s/g, '');
}

const DATE_TIME = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** 'YYYY/MM/DD HH:MM(:SS)' をローカル時刻の epoch ミリ秒にする。読めなければ null */
export function toEpoch(s: string): number | null {
	const m = s.trim().match(DATE_TIME);
	if (!m) return null;
	const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => Number(x ?? 0));
	const date = new Date(y, mo - 1, d, h, mi, sec);
	// 2024/02/30 のような存在しない日時は繰り上がるので、読めないものとして扱う
	if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
	return date.getTime();
}

/** 'YYYY/MM/DD' → 'YYYY-MM-DD'。空は ''、形が違えば trim した元の値 */
export function toIsoDate(s: string): string {
	const t = s.trim();
	const m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
	return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : t;
}

/** 改行を戻したコメントのセル（`YYYY/MM/DD HH:MM 名前\n本文`）を読む。本文が空なら null */
export function parseBacklogComment(cell: string): BacklogComment | null {
	const [first, ...rest] = cell.split('\n');
	const m = first.match(/^(\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}(?::\d{2})?) (.*)$/);
	const comment = m
		? { at: toEpoch(m[1]), author: m[2].trim(), body: rest.join('\n').trim() }
		: { at: null, author: '', body: cell.trim() };
	return comment.body === '' ? null : comment;
}

/** 新しい順に並んでいれば古い順にする（並べ替えはしない） */
function oldestFirst(comments: BacklogComment[]): BacklogComment[] {
	const dated = comments.filter((c) => c.at !== null);
	if (dated.length >= 2 && dated[0].at! > dated[dated.length - 1].at!) {
		return [...comments].reverse();
	}
	return comments;
}

const list = (s: string, upper = false) => [
	...new Set(
		s
			.split(',')
			.map((x) => (upper ? x.trim().toUpperCase() : x.trim()))
			.filter((x) => x !== '')
	)
];

export function readBacklogIssues(
	text: string
): { ok: true; rows: BacklogIssueRow[] } | { ok: false; message: string } {
	const [header = [], ...lines] = parseCsv(text);
	const required = columnIndex(header, REQUIRED);
	if (!required) {
		return {
			ok: false,
			message:
				'Backlog の課題 CSV ではないようです（「キー」「件名」「詳細」「状態」「登録者」「登録日」の列が必要です）'
		};
	}
	const trimmed = header.map((h) => h.trim());
	const index = new Map<Column, number>(Object.entries(required) as [Column, number][]);
	for (const name of OPTIONAL) {
		const i = trimmed.indexOf(name);
		if (i >= 0) index.set(name, i);
	}
	// 「コメントN」の N の順に読む（列の並びには依存しない）
	const commentColumns = trimmed
		.map((h, i) => ({ n: Number(h.match(/^コメント(\d+)$/)?.[1]), i }))
		.filter((c) => !Number.isNaN(c.n))
		.sort((a, b) => a.n - b.n)
		.map((c) => c.i);

	// 表計算ソフトで保存し直すと、末尾に ",,,,," だけの行が付くことがある
	const body = lines.filter((cells) => cells.some((c) => c.trim() !== ''));
	if (body.length === 0) return { ok: false, message: 'CSV に課題がありません' };
	if (body.length > MAX_IMPORT_ISSUES) {
		return {
			ok: false,
			message: `一度に取り込めるのは${MAX_IMPORT_ISSUES}件までです。Backlog で絞り込んで CSV を分けてください`
		};
	}
	const rows = body.map((cells, i): BacklogIssueRow => {
		const raw = (name: Column) => {
			const at = index.get(name);
			return at === undefined ? '' : (cells[at] ?? '');
		};
		const cell = (name: Column) => raw(name).trim();
		const key = cell('キー').toUpperCase();
		const keyIdCell = cell('キーID');
		const keyId = /^\d+$/.test(keyIdCell)
			? Number(keyIdCell)
			: /-(\d+)$/.test(key)
				? Number(key.match(/-(\d+)$/)![1])
				: null;
		const attachments = Number(cell('添付'));
		const comments = commentColumns
			.map((c) => parseBacklogComment(restoreNewlines(cells[c] ?? '')))
			.filter((c): c is BacklogComment => c !== null);
		return {
			rowNumber: i + 2,
			key,
			keyId,
			type: cell('種別'),
			categories: list(cell('カテゴリー名')),
			milestones: list(cell('マイルストーン')),
			version: cell('発生バージョン'),
			title: cell('件名'),
			description: restoreNewlines(raw('詳細')).trimEnd(),
			status: cell('状態'),
			priority: cell('優先度'),
			resolution: cell('完了理由'),
			assignee: cell('担当者'),
			reporter: cell('登録者'),
			parentKey: cell('親課題キー').toUpperCase(),
			createdAt: toEpoch(cell('登録日')),
			updatedAt: toEpoch(cell('更新日')),
			startDate: toIsoDate(cell('開始日')),
			dueDate: toIsoDate(cell('期限日')),
			estimatedHours: cell('予定時間'),
			actualHours: cell('実績時間'),
			attachments: Number.isInteger(attachments) && attachments > 0 ? attachments : 0,
			comments: oldestFirst(comments)
		};
	});
	const commentCount = rows.reduce((n, r) => n + r.comments.length, 0);
	if (commentCount > MAX_IMPORT_COMMENTS) {
		return {
			ok: false,
			message: `一度に取り込めるコメントは${MAX_IMPORT_COMMENTS.toLocaleString('en-US')}件までです。Backlog で絞り込んで CSV を分けてください`
		};
	}
	return { ok: true, rows };
}

export interface IssueImportResult {
	issues: number;
	comments: number;
	firstNumber: number;
	lastNumber: number;
	/** 行のエラーで取り込まなかった行の数 */
	skipped: number;
	created: { statuses: number; types: number; categories: number; milestones: number };
}

const CREATED_LABEL: [keyof IssueImportResult['created'], string][] = [
	['statuses', 'ステータス'],
	['types', '種別'],
	['categories', 'カテゴリー'],
	['milestones', 'マイルストーン']
];

export function formatIssueImportResult(r: IssueImportResult): string {
	const range =
		r.firstNumber === r.lastNumber ? `#${r.firstNumber}` : `#${r.firstNumber}〜#${r.lastNumber}`;
	const created = CREATED_LABEL.filter(([k]) => r.created[k] > 0)
		.map(([k, label]) => `${label} ${r.created[k]}`)
		.join('、');
	return [
		`課題 ${r.issues} 件（${range}）とコメント ${r.comments} 件を取り込みました`,
		r.skipped > 0 && `取り込まなかった行 ${r.skipped} 件`,
		created && `作成したもの: ${created}`
	]
		.filter(Boolean)
		.join('。');
}
