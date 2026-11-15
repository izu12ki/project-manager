import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	formatImportPreview,
	formatImportResult,
	inviteAllowed,
	readBacklogUsers,
	roleFromBacklog,
	type BacklogUserRow
} from '#lib/backlog-users.ts';
import { decodeCsv } from '#lib/csv.ts';

const fixture = readFileSync(new URL('./testdata/backlog/users.csv', import.meta.url));
const KEY_HEADER = '参加中のプロジェクトキー（アーカイブ済みを除く）';

function load(text: string): BacklogUserRow[] {
	const result = readBacklogUsers(text);
	if (!result.ok) throw new Error(result.message);
	return result.rows;
}

describe('readBacklogUsers', () => {
	const text = decodeCsv(fixture);
	const rows = load(text);

	it('固定の CSV から 10 行を読む', () => {
		expect(rows).toHaveLength(10);
		expect(rows[0].rowNumber).toBe(2);
		expect(rows[1]).toEqual({
			rowNumber: 3,
			name: '鈴木 花子',
			email: 'hanako.suzuki@example.com',
			backlogRole: '一般ユーザー',
			status: '有効',
			projectKeys: ['DEMO', 'LONG_PROJECT_KEY_01']
		});
		expect(rows.find((r) => r.name.startsWith('中村'))?.projectKeys).toEqual([]);
		expect(rows.some((r) => r.name === '髙田 一郎①')).toBe(true);
	});

	it('BOM・CRLF・引用符なし・末尾の空行でも同じ rows になる', () => {
		const lines = text.split('\n').filter((l) => l !== '');
		const plain = lines
			.map((line) => {
				const cells = line.slice(1, -1).split('","');
				const last = cells.length - 1;
				return cells.map((c, i) => (i === last && c !== KEY_HEADER ? `"${c}"` : c)).join(',');
			})
			.join('\r\n');
		expect(load('﻿' + plain + '\r\n\r\n\r\n')).toEqual(rows);
	});

	it('列の順を入れ替えても同じ rows になる', () => {
		const reordered = text
			.split('\n')
			.filter((l) => l !== '')
			.map((line) => {
				const cells = line.slice(1, -1).split('","');
				return '"' + [...cells].reverse().join('","') + '"';
			})
			.join('\n');
		expect(load(reordered)).toEqual(rows);
	});

	it('すべてのセルが空の行は読み飛ばす', () => {
		expect(load(text + ',,,,,,,,,,\n,,,,,,,,,,\n')).toEqual(rows);
		expect(load(text + ' , ,\t,\n')).toEqual(rows);
	});

	it('必須の列が欠けるとエラー', () => {
		const result = readBacklogUsers('"ハンドルネーム","メールアドレス"\n"a","a@example.com"\n');
		expect(result).toEqual({
			ok: false,
			message:
				'Backlog のユーザー CSV ではないようです（「ハンドルネーム」「メールアドレス」「権限」「状態」「参加中のプロジェクトキー（アーカイブ済みを除く）」の列が必要です）'
		});
	});

	it('ヘッダーだけならユーザーがいない', () => {
		const header = `ハンドルネーム,メールアドレス,権限,状態,${KEY_HEADER}\n`;
		expect(readBacklogUsers(header)).toEqual({ ok: false, message: 'CSV にユーザーがいません' });
	});

	it('1,001 行なら多すぎる', () => {
		const header = `ハンドルネーム,メールアドレス,権限,状態,${KEY_HEADER}\n`;
		const body = (n: number) =>
			Array.from({ length: n }, (_, i) => `u${i},u${i}@example.com,一般ユーザー,有効,DEMO\n`).join(
				''
			);
		expect(readBacklogUsers(header + body(1000)).ok).toBe(true);
		expect(readBacklogUsers(header + body(1001))).toEqual({
			ok: false,
			message: '一度に読み込めるのは1000人までです'
		});
	});
});

describe('roleFromBacklog', () => {
	it('Backlog の権限をロールに対応させる', () => {
		expect(roleFromBacklog('管理者')).toBe('admin');
		expect(roleFromBacklog('一般ユーザー')).toBe('member');
		expect(roleFromBacklog('レポーター')).toBe('member');
		expect(roleFromBacklog('ゲストレポーター')).toBe('guest');
		expect(roleFromBacklog('ゲストビューワー')).toBe('guest');
		expect(roleFromBacklog('ビューワー')).toBe('guest');
		expect(roleFromBacklog('')).toBe('guest');
	});
});

describe('inviteAllowed', () => {
	it('管理者以外はプロジェクトが必要', () => {
		expect(inviteAllowed('admin', 0)).toBe(true);
		expect(inviteAllowed('member', 0)).toBe(false);
		expect(inviteAllowed('guest', 1)).toBe(true);
	});
});

describe('formatImportResult', () => {
	it('理由を SKIP_LABEL の定義順に並べる', () => {
		expect(
			formatImportResult({
				invited: 6,
				joined: 1,
				skipped: { no_projects: 1, inactive: 1, duplicate: 1 },
				mailFailed: 0
			})
		).toBe(
			'招待 6 人、参加の追加 1 人、取り込まなかった人 3 人（Backlog で有効でない 1、CSV 内でメールアドレスが重複 1、参加できるプロジェクトがない 1）'
		);
	});

	it('skipped が空なら括弧なし', () => {
		expect(formatImportResult({ invited: 2, joined: 0, skipped: {}, mailFailed: 0 })).toBe(
			'招待 2 人、参加の追加 0 人、取り込まなかった人 0 人'
		);
	});

	it('招待メールを送れなかった人がいれば最後に足す', () => {
		expect(
			formatImportResult({ invited: 3, joined: 1, skipped: { inactive: 1 }, mailFailed: 2 })
		).toBe(
			'招待 3 人、参加の追加 1 人、取り込まなかった人 1 人（Backlog で有効でない 1）。招待メールを送れなかった人 2 人（招待中の一覧の「リンクを再発行」でリンクを渡してください）'
		);
	});
});

describe('formatImportPreview', () => {
	it('取り込む人数と、取り込まない理由の内訳を出す', () => {
		expect(
			formatImportPreview({ invite: 5, join: 1, skipped: { unselected: 1, inactive: 1 } })
		).toBe(
			'招待 5 人、参加の追加 1 人。取り込まない人 2 人（Backlog で有効でない 1、チェックを外した 1）'
		);
	});

	it('取り込まない人がいなければ内訳を出さない', () => {
		expect(formatImportPreview({ invite: 2, join: 0, skipped: {} })).toBe(
			'招待 2 人、参加の追加 0 人'
		);
	});

	it('取り込む人がいなければ、そう書いて理由を並べる', () => {
		expect(
			formatImportPreview({ invite: 0, join: 0, skipped: { no_projects: 12, already_joined: 1 } })
		).toBe('取り込む人がいません（参加済み 1、参加できるプロジェクトがない 12）');
	});
});
