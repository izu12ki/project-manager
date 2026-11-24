import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	carryOver,
	formatIssueImportResult,
	parseBacklogComment,
	personKey,
	readBacklogIssues,
	type BacklogIssueRow
} from '#lib/backlog-issues.ts';
import { decodeCsv, parseCsv } from '#lib/csv.ts';

const fixtureText = (name: string) =>
	decodeCsv(readFileSync(new URL(`./testdata/backlog/${name}`, import.meta.url)));

function load(text: string): BacklogIssueRow[] {
	const result = readBacklogIssues(text);
	if (!result.ok) throw new Error(result.message);
	return result.rows;
}

const toCsv = (rows: string[][]) =>
	rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
	new Date(y, mo - 1, d, h, mi).getTime();

const REQUIRED = ['キー', '件名', '詳細', '状態', '登録者', '登録日'];

describe('readBacklogIssues', () => {
	const text = fixtureText('issues.csv');
	const rows = load(text);
	const byKey = (key: string) => rows.find((r) => r.key === key)!;

	it('固定の CSV（58 列）から 7 行を読む', () => {
		expect(rows.map((r) => r.key)).toEqual([
			'DEMO-1',
			'DEMO-5',
			'DEMO-4',
			'DEMO-2',
			'DEMO-3',
			'DEMO-6',
			'DEMO-7'
		]);
		expect(byKey('DEMO-1')).toEqual({
			rowNumber: 2,
			key: 'DEMO-1',
			keyId: 1,
			type: 'タスク',
			categories: ['機能A', '確定度 60%'],
			milestones: ['v1.0', 'v1.1'],
			version: '',
			title: 'ログイン画面を作る',
			description: '画面の要件:\n- メールアドレス\n- パスワード\n\n"引用符"とカンマ, を含む',
			status: '未対応',
			priority: '中',
			resolution: '',
			assignee: '鈴木 花子',
			reporter: '山田 太郎',
			parentKey: '',
			createdAt: at(2024, 1, 10, 9, 15),
			updatedAt: at(2024, 2, 1, 18, 0),
			startDate: '2024-01-15',
			dueDate: '2024-01-31',
			estimatedHours: '',
			actualHours: '',
			attachments: 0,
			extra: [],
			comments: [
				{
					at: at(2024, 1, 12, 10, 30),
					author: '鈴木 花子',
					body: '確認しました。\n明日から着手します。'
				},
				{ at: at(2024, 1, 20, 17, 5), author: '架空商事 小林', body: '仕様の確認をお願いします' }
			]
		});
	});

	it('新しい順に並んだコメントは古い順にし、CP932 の文字も読める', () => {
		const r = byKey('DEMO-3');
		expect(r.comments.map((c) => [c.author, c.body])).toEqual([
			['鈴木 花子', 'よろしくお願いします'],
			['髙田 一郎①', '調査が終わりました']
		]);
		expect(r).toMatchObject({
			assignee: '髙田 一郎①',
			attachments: 2,
			estimatedHours: '3',
			actualHours: '2.5',
			version: '1.0',
			parentKey: 'DEMO-99',
			status: '保留'
		});
		expect(byKey('DEMO-5').assignee).toBe('開発　花子');
		expect(byKey('DEMO-7').title).toBe('');
	});

	it('コメント列の数が違う CSV（37 列）も読む', () => {
		const rows2 = load(fixtureText('issues-2.csv'));
		expect(rows2.map((r) => r.key)).toEqual(['DEMO-8', 'DEMO-9']);
		expect(rows2[0].comments).toEqual([
			{ at: at(2024, 4, 2, 11, 0), author: '鈴木 花子', body: '対応します' }
		]);
		expect(rows2[0].parentKey).toBe('DEMO-1');
	});

	it('列の順を入れ替えても同じ行になる', () => {
		const table = parseCsv(text);
		const order = table[0].map((_, i) => i).reverse();
		expect(load(toCsv(table.map((r) => order.map((i) => r[i]))))).toEqual(rows);
	});

	it('必須でない列がなくても読める', () => {
		const table = parseCsv(text);
		const keep = table[0]
			.map((h, i) => [h, i] as const)
			.filter(([h]) => h !== '親課題キー' && !h.startsWith('コメント'))
			.map(([, i]) => i);
		const got = load(toCsv(table.map((r) => keep.map((i) => r[i]))));
		expect(got.find((r) => r.key === 'DEMO-2')).toMatchObject({ parentKey: '', comments: [] });
	});

	it('知らない列（カスタム属性など）の値を、列の順に読む。空の値・使わない列・名前のない列は除く', () => {
		const got = load(
			toCsv([
				[...REQUIRED, 'ID', '顧客', '', ' 見積額 ', '共有', 'コメント1', '更新者'],
				[
					'DEMO-1',
					'件名',
					'',
					'未対応',
					'鈴木 花子',
					'2024/01/01 10:00',
					'123',
					' 架空商事 ',
					'名前のない列',
					'1,000\\n税別',
					'1',
					'',
					'鈴木 花子'
				],
				[
					'DEMO-2',
					'件名',
					'',
					'未対応',
					'鈴木 花子',
					'2024/01/01 10:00',
					'124',
					'  ',
					'',
					'',
					'',
					'',
					''
				]
			])
		);
		expect(got.map((r) => r.extra)).toEqual([
			[
				{ name: '顧客', value: '架空商事' },
				{ name: '見積額', value: '1,000\n税別' }
			],
			[]
		]);
	});

	it('キー ID が空なら、キーの番号を使う', () => {
		const table = parseCsv(text);
		const col = table[0].indexOf('キーID');
		const got = load(toCsv(table.map((r, i) => (i === 0 ? r : r.with(col, '')))));
		expect(got.map((r) => r.keyId)).toEqual([1, 5, 4, 2, 3, 6, 7]);
	});

	it('読めない CSV は理由を返す', () => {
		expect(readBacklogIssues('"ユーザーID","ハンドルネーム"\n"a","b"\n')).toEqual({
			ok: false,
			message:
				'Backlog の課題 CSV ではないようです（「キー」「件名」「詳細」「状態」「登録者」「登録日」の列が必要です）'
		});
		expect(readBacklogIssues(toCsv([REQUIRED]))).toEqual({
			ok: false,
			message: 'CSV に課題がありません'
		});
		const many = Array.from({ length: 501 }, (_, i) => [
			`DEMO-${i + 1}`,
			'件名',
			'',
			'未対応',
			'鈴木 花子',
			'2024/01/01 10:00'
		]);
		expect(readBacklogIssues(toCsv([REQUIRED, ...many]))).toEqual({
			ok: false,
			message: '一度に取り込めるのは500件までです。Backlog で絞り込んで CSV を分けてください'
		});
		const commentHeader = Array.from({ length: 5001 }, (_, i) => `コメント${i + 1}`);
		const comments = commentHeader.map(() => '2024/01/01 10:00 鈴木 花子\\nはい');
		expect(
			readBacklogIssues(
				toCsv([
					[...REQUIRED, ...commentHeader],
					['DEMO-1', '件名', '', '未対応', '鈴木 花子', '2024/01/01 10:00', ...comments]
				])
			)
		).toEqual({
			ok: false,
			message:
				'一度に取り込めるコメントは5,000件までです。Backlog で絞り込んで CSV を分けてください'
		});
	});
});

describe('parseBacklogComment', () => {
	it('1 行目の日時の後ろの残りすべてを名前にする', () => {
		expect(parseBacklogComment('2024/01/02 03:04 会社名 山田 太郎\n本文\n2 行目')).toEqual({
			at: at(2024, 1, 2, 3, 4),
			author: '会社名 山田 太郎',
			body: '本文\n2 行目'
		});
		expect(parseBacklogComment('2024/01/01 10:00:30 山田 太郎\nx')).toEqual({
			at: new Date(2024, 0, 1, 10, 0, 30).getTime(),
			author: '山田 太郎',
			body: 'x'
		});
	});

	it('日時で始まらないセルは本文だけ、本文が空なら null', () => {
		expect(parseBacklogComment(' 自由な文 \n続き ')).toEqual({
			at: null,
			author: '',
			body: '自由な文 \n続き'
		});
		expect(parseBacklogComment('2024/01/01 10:00 鈴木 花子')).toBeNull();
		expect(parseBacklogComment('2024/01/01 10:00 鈴木 花子\n  ')).toBeNull();
		expect(parseBacklogComment('')).toBeNull();
	});
});

describe('carryOver', () => {
	it('入れた値を名前ごとに引き継ぎ、新しい名前は初期値にする', () => {
		expect(carryOver({ 'v1.0': '2026-12-15' }, ['v1.0', 'v2.0'], () => '')).toEqual({
			'v1.0': '2026-12-15',
			'v2.0': ''
		});
		// 空文字（「不明なユーザー」を選び直したなど）も入れた値として保つ
		expect(carryOver({ 山田: '' }, ['山田'], () => 'u1')).toEqual({ 山田: '' });
	});

	it('今回の名前にないものも残す（書き方の切り替えで一時的に消えても、戻せば元の値）', () => {
		const once = carryOver({ 'v1.0': '2026-12-15' }, ['v2.0'], () => '');
		expect(carryOver(once, ['v1.0', 'v2.0'], () => '')).toEqual({
			'v1.0': '2026-12-15',
			'v2.0': ''
		});
	});

	it('Object のプロパティ名（constructor など）も、ほかの名前と同じく初期値にする', () => {
		expect(carryOver({}, ['constructor', 'toString', '__proto__'], () => '')).toEqual(
			Object.fromEntries([
				['constructor', ''],
				['toString', ''],
				['__proto__', '']
			])
		);
	});
});

describe('personKey', () => {
	it('全角・半角の空白をすべて除く', () => {
		expect(personKey(' 開発　花子 ')).toBe(personKey('開発 花子'));
		expect(personKey('開発 花子')).toBe('開発花子');
	});
});

describe('formatIssueImportResult', () => {
	it('件数、取り込まなかった行、作ったものをつなぐ', () => {
		expect(
			formatIssueImportResult({
				issues: 6,
				comments: 5,
				firstNumber: 1,
				lastNumber: 6,
				skipped: 1,
				created: { statuses: 1, types: 1, categories: 3, milestones: 1 }
			})
		).toBe(
			'課題 6 件（#1〜#6）とコメント 5 件を取り込みました。取り込まなかった行 1 件。作成したもの: ステータス 1、種別 1、カテゴリー 3、マイルストーン 1'
		);
		expect(
			formatIssueImportResult({
				issues: 1,
				comments: 0,
				firstNumber: 7,
				lastNumber: 7,
				skipped: 0,
				created: { statuses: 0, types: 0, categories: 2, milestones: 0 }
			})
		).toBe('課題 1 件（#7）とコメント 0 件を取り込みました。作成したもの: カテゴリー 2');
		expect(
			formatIssueImportResult({
				issues: 1,
				comments: 0,
				firstNumber: 7,
				lastNumber: 7,
				skipped: 0,
				created: { statuses: 0, types: 0, categories: 0, milestones: 0 }
			})
		).toBe('課題 1 件（#7）とコメント 0 件を取り込みました');
	});
});
