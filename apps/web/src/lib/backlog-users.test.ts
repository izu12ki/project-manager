import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	formatImportFailure,
	formatImportPreview,
	formatImportResult,
	IMPORT_CHUNK,
	inviteAllowed,
	mergeImportResults,
	readBacklogUsers,
	roleFromBacklog,
	sendImportChunks,
	type BacklogUserRow
} from '#lib/backlog-users.ts';
import { decodeCsv } from '#lib/csv.ts';
import { MAIL_PLAN_RESTRICTED } from '#lib/mail.ts';

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
				inviteFailed: [],
				mailFailed: []
			})
		).toBe(
			'招待 6 人、参加の追加 1 人、取り込まなかった人 3 人（Backlog で有効でない 1、CSV 内でメールアドレスが重複 1、参加できるプロジェクトがない 1）'
		);
	});

	it('skipped が空なら括弧なし', () => {
		expect(
			formatImportResult({ invited: 2, joined: 0, skipped: {}, inviteFailed: [], mailFailed: [] })
		).toBe('招待 2 人、参加の追加 0 人、取り込まなかった人 0 人');
	});

	it('招待メールを送れなかった人がいれば、名前（なければメールアドレス）を最後に足す', () => {
		expect(
			formatImportResult({
				invited: 3,
				joined: 1,
				skipped: { inactive: 1 },
				inviteFailed: [],
				mailFailed: [
					{ name: '佐藤 花子', email: 'hanako@example.com' },
					{ name: '', email: 'c@example.com' }
				]
			})
		).toBe(
			'招待 3 人、参加の追加 1 人、取り込まなかった人 1 人（Backlog で有効でない 1）。招待メールを送れなかった人 2 人: 佐藤 花子（hanako@example.com）、c@example.com。招待中の一覧の「リンクを再発行」でリンクを渡してください'
		);
	});

	it('Cloudflare の無料プランの宛先の制限で送れなかったら、その説明を足す', () => {
		expect(
			formatImportResult({
				invited: 1,
				joined: 0,
				skipped: {},
				inviteFailed: [],
				mailFailed: [{ name: '', email: 'c@example.com' }],
				mailRestricted: true
			})
		).toBe(
			`招待 1 人、参加の追加 0 人、取り込まなかった人 0 人。招待メールを送れなかった人 1 人: c@example.com。${MAIL_PLAN_RESTRICTED}。招待中の一覧の「リンクを再発行」でリンクを渡してください`
		);
	});

	it('招待できなかった人がいれば、メールを送れなかった人より前に足す', () => {
		expect(
			formatImportResult({
				invited: 1,
				joined: 0,
				skipped: {},
				inviteFailed: [{ name: '山田 太郎', email: 'taro@example.com' }],
				mailFailed: [{ name: '', email: 'c@example.com' }]
			})
		).toBe(
			'招待 1 人、参加の追加 0 人、取り込まなかった人 0 人。招待できなかった人 1 人: 山田 太郎（taro@example.com）。CSV を読み込み直して確認してください。招待メールを送れなかった人 1 人: c@example.com。招待中の一覧の「リンクを再発行」でリンクを渡してください'
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

describe('mergeImportResults', () => {
	it('分けて送った結果の人数・理由別の数・失敗した人を足し合わせる', () => {
		const a = { name: 'A', email: 'a@example.com' };
		const b = { name: 'B', email: 'b@example.com' };
		expect(
			mergeImportResults([
				{
					invited: 0,
					joined: 0,
					skipped: { inactive: 1, unselected: 2 },
					inviteFailed: [],
					mailFailed: []
				},
				{ invited: 3, joined: 1, skipped: {}, inviteFailed: [a], mailFailed: [] },
				{
					invited: 2,
					joined: 0,
					skipped: { unselected: 1, already_joined: 1 },
					inviteFailed: [],
					mailFailed: [b],
					mailRestricted: true
				}
			])
		).toEqual({
			invited: 5,
			joined: 1,
			skipped: { inactive: 1, unselected: 3, already_joined: 1 },
			inviteFailed: [a],
			mailFailed: [b],
			mailRestricted: true
		});
	});
});

describe('sendImportChunks', () => {
	const ok = (n: number) => ({
		invited: n,
		joined: 0,
		skipped: {},
		inviteFailed: [],
		mailFailed: []
	});
	const people = Array.from({ length: IMPORT_CHUNK * 2 + 3 }, (_, i) => i);

	it('IMPORT_CHUNK 人ずつ順に送り、送り終えた人数を知らせる', async () => {
		const sentRows: number[][] = [];
		const progress: number[] = [];
		const got = await sendImportChunks(
			people,
			async (rows) => {
				sentRows.push(rows);
				return ok(rows.length);
			},
			(n) => progress.push(n)
		);
		expect(sentRows.map((r) => r.length)).toEqual([IMPORT_CHUNK, IMPORT_CHUNK, 3]);
		expect(sentRows.flat()).toEqual(people);
		expect(progress).toEqual([IMPORT_CHUNK, IMPORT_CHUNK * 2, people.length]);
		expect(got).toEqual({ ok: true, results: [ok(IMPORT_CHUNK), ok(IMPORT_CHUNK), ok(3)] });
	});

	it('途中で失敗したら残りは送らず、送り終えた回の結果と人数を返す', async () => {
		const error = new Error('boom');
		let calls = 0;
		const got = await sendImportChunks(people, async (rows) => {
			if (++calls === 2) throw error;
			return ok(rows.length);
		});
		expect(calls).toBe(2);
		expect(got).toEqual({ ok: false, results: [ok(IMPORT_CHUNK)], sent: IMPORT_CHUNK, error });
	});
});

describe('formatImportFailure', () => {
	it('済んだ人数と、どこから済んでいないかもしれないかを伝える', () => {
		expect(formatImportFailure('途中で失敗しました', 20, 8)).toBe(
			'途中で失敗しました。20 人のうち 8 人までは済みました。9 人目からは、済んでいないか一部だけ済んでいる可能性があります。CSV を読み込み直して確認してください'
		);
	});

	it('最初の回で失敗したときは人数を出さない', () => {
		expect(formatImportFailure('途中で失敗しました', 20, 0)).toBe(
			'途中で失敗しました。招待や参加の追加は済んでいないか、一部だけ済んでいる可能性があります。CSV を読み込み直して確認してください'
		);
	});
});
