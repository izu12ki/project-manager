import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { readBacklogIssues, type BacklogIssueRow } from '#lib/backlog-issues.ts';
import { decodeCsv } from '#lib/csv.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { invitation, issue, issueStatus, user } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { planIssueImport } from './issue-import';
import { unknownUserInsert } from './users';

function fixture(name: string): BacklogIssueRow[] {
	const text = decodeCsv(readFileSync(new URL(`../../testdata/backlog/${name}`, import.meta.url)));
	const result = readBacklogIssues(text);
	if (!result.ok) throw new Error(result.message);
	return result.rows;
}

let n = 0;
function row(over: Partial<BacklogIssueRow> = {}): BacklogIssueRow {
	n += 1;
	return {
		rowNumber: n + 1,
		key: `DEMO-${n}`,
		keyId: n,
		type: '',
		categories: [],
		milestones: [],
		version: '',
		title: `課題 ${n}`,
		description: '',
		status: '未対応',
		priority: '中',
		resolution: '',
		assignee: '',
		reporter: '',
		parentKey: '',
		createdAt: new Date(2024, 0, 1, 9, 0).getTime(),
		updatedAt: null,
		startDate: '',
		dueDate: '',
		estimatedHours: '',
		actualHours: '',
		attachments: 0,
		comments: [],
		...over
	};
}

describe('issue-import: plan', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor;
	let member: Actor;
	let projectId: string;

	beforeEach(async () => {
		n = 0;
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理者');
		member = await seedUser(db, 'member', '鈴木 花子');
		({ id: projectId } = await seedProject(db, { key: 'DEMO', members: [member] }));
	});

	const plan = (rows: BacklogIssueRow[], key = 'DEMO') =>
		planIssueImport(ctxOf(base, admin), key, { rows });

	it('管理者以外は使えず、アーカイブ済みのプロジェクトには取り込めない', async () => {
		await expect(
			planIssueImport(ctxOf(base, member), 'DEMO', { rows: [row()] })
		).rejects.toMatchObject({ code: 'forbidden' });
		await seedProject(db, { key: 'OLD', archived: true });
		await expect(plan([row()], 'OLD')).rejects.toMatchObject({ code: 'conflict' });
	});

	it('固定の CSV から件数・作るもの・行のエラーを返す', async () => {
		const p = await plan(fixture('issues.csv'));
		expect(p).toMatchObject({
			issues: 6,
			comments: 5,
			firstNumber: 1,
			backlogProjects: ['DEMO'],
			created: {
				statuses: ['保留'],
				types: ['調査'],
				categories: ['機能A', '確定度 60%', '機能B'],
				milestones: ['v1.0']
			},
			rowErrors: [{ rowNumber: 8, key: 'DEMO-7', reason: '件名がありません' }],
			alreadyImported: []
		});
	});

	it('名前は空白を無視して自動で選び、同名が複数なら選ばない', async () => {
		const dev = await seedUser(db, 'member', '開発 花子');
		await seedUser(db, 'member', '佐藤 一郎');
		await seedUser(db, 'guest', '佐藤 一郎');
		const disabled = await seedUser(db, 'member', '無効 太郎');
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, disabled.id));
		await db.batch([unknownUserInsert(db)]);
		await db.insert(invitation).values({
			id: 'inv1',
			email: 'yamada@example.com',
			role: 'member',
			name: '山田 太郎',
			tokenHash: 'h1',
			invitedBy: admin.id,
			expiresAt: new Date(Date.now() + 86_400_000)
		});
		const p = await plan([
			row({ assignee: '開発　花子', reporter: '佐藤一郎' }),
			row({
				assignee: '開発 花子',
				reporter: '山田 太郎',
				comments: [
					{ at: null, author: '架空商事 小林', body: 'a' },
					{ at: null, author: '無効 太郎', body: 'b' },
					{ at: null, author: '開発花子', body: 'c' }
				]
			})
		]);
		expect(p.people).toEqual([
			{
				name: '開発　花子',
				uses: { reporter: 0, assignee: 2, comment: 1 },
				userId: dev.id,
				match: 'auto'
			},
			{
				name: '佐藤一郎',
				uses: { reporter: 1, assignee: 0, comment: 0 },
				userId: null,
				match: 'ambiguous'
			},
			{
				name: '山田 太郎',
				uses: { reporter: 1, assignee: 0, comment: 0 },
				userId: null,
				match: 'pending'
			},
			{
				name: '架空商事 小林',
				uses: { reporter: 0, assignee: 0, comment: 1 },
				userId: null,
				match: 'none'
			},
			{
				name: '無効 太郎',
				uses: { reporter: 0, assignee: 0, comment: 1 },
				userId: null,
				match: 'none'
			}
		]);
		const ids = p.users.map((u) => u.id);
		expect(ids).not.toContain(disabled.id);
		expect(ids).not.toContain('unknown-user');
		expect(p.users.find((u) => u.id === member.id)).toMatchObject({ member: true });
		expect(p.users.find((u) => u.id === dev.id)).toMatchObject({ member: false });
		expect(p.users.find((u) => u.id === admin.id)).toMatchObject({ member: true });
	});

	it('同名のステータスがあればそちらを優先する', async () => {
		await db
			.insert(issueStatus)
			.values({ projectId, key: 'custom-1', name: '未対応', color: 'gray', position: 10 });
		await db.delete(issueStatus).where(eq(issueStatus.key, 'in_progress'));
		const p = await plan([row({ status: '未対応' }), row({ status: '処理中' })]);
		expect(p.created.statuses).toEqual(['処理中']);
	});

	it('行のエラーを理由付きで返す', async () => {
		const p = await plan([
			row({ key: 'DEMO', keyId: null }),
			row({ key: 'DEMO-100', keyId: 100 }),
			row({ key: 'DEMO-100', keyId: 100 }),
			row({ title: 'あ'.repeat(201) }),
			row({ createdAt: null }),
			row({ startDate: '2024-02-30' }),
			row({ dueDate: '2024/13/01' }),
			row({ startDate: '2024-02-02', dueDate: '2024-02-01' }),
			row({ categories: ['あ'.repeat(51)] }),
			row({ description: 'あ'.repeat(50_000) }),
			row({ comments: [{ at: null, author: '', body: 'あ'.repeat(20_001) }] }),
			row({ title: 'あ'.repeat(200), startDate: '2024-02-29', dueDate: '2024-02-29' })
		]);
		expect(p.rowErrors.map((e) => [e.rowNumber, e.key, e.reason])).toEqual([
			[2, 'DEMO', 'キーの形式が正しくありません'],
			[4, 'DEMO-100', 'CSV 内でキーが重複しています'],
			[5, 'DEMO-4', '件名が200文字を超えています'],
			[6, 'DEMO-5', '登録日の形式が正しくありません'],
			[7, 'DEMO-6', '開始日の形式が正しくありません'],
			[8, 'DEMO-7', '期限日の形式が正しくありません'],
			[9, 'DEMO-8', '開始日が期限日より後です'],
			[10, 'DEMO-9', '種別・カテゴリー・マイルストーン・状態の名前は50文字までです'],
			[11, 'DEMO-10', '詳細が50,000文字を超えています'],
			[12, 'DEMO-11', 'コメントが20,000文字を超えています']
		]);
		expect(p.issues).toBe(2);
	});

	it('取り込み済みのキーを返す（削除済みを含む）', async () => {
		await db.insert(issue).values({
			id: 'old',
			projectId,
			number: 1,
			title: 'old',
			reporterId: admin.id,
			position: 'a0',
			backlogKey: 'DEMO-1',
			deletedAt: new Date()
		});
		const p = await plan([row(), row()]);
		expect(p.alreadyImported).toEqual(['DEMO-1']);
		expect(p.firstNumber).toBe(1);
	});

	it('上限を超えた入力は validation', async () => {
		await expect(plan(Array.from({ length: 501 }, () => row()))).rejects.toMatchObject({
			code: 'validation'
		});
		const comments = Array.from({ length: 2501 }, () => ({ at: null, author: '', body: 'x' }));
		await expect(plan([row({ comments }), row({ comments })])).rejects.toMatchObject({
			code: 'validation',
			message:
				'一度に取り込めるコメントは5,000件までです。Backlog で絞り込んで CSV を分けてください'
		});
	});
});
