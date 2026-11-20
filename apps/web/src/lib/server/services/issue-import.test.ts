import { asc, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { readBacklogIssues, type BacklogIssueRow } from '#lib/backlog-issues.ts';
import { decodeCsv } from '#lib/csv.ts';
import type { Actor } from '../authz';
import type { DB } from '../db';
import {
	category,
	comment,
	invitation,
	issue,
	issueChange,
	issueStatus,
	issueType,
	milestone,
	notification,
	project,
	projectMember,
	user
} from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { importIssues, planIssueImport, type IssueImportPlan } from './issue-import';
import { listCategories } from './issue-fields';
import { createIssue } from './issues';
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

const autoPeople = (plan: IssueImportPlan) =>
	plan.people.map((x) => ({ name: x.name, userId: x.userId }));

describe('issue-import: run', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor;
	let suzuki: Actor;
	let dev: Actor;
	let projectId: string;

	beforeEach(async () => {
		n = 0;
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin', '管理者');
		suzuki = await seedUser(db, 'member', '鈴木 花子');
		dev = await seedUser(db, 'member', '開発 花子');
		({ id: projectId } = await seedProject(db, { key: 'DEMO', members: [suzuki] }));
	});

	const ctx = () => ctxOf(base, admin);
	async function run(rows: BacklogIssueRow[], people?: { name: string; userId: string | null }[]) {
		const plan = await planIssueImport(ctx(), 'DEMO', { rows });
		return importIssues(ctx(), 'DEMO', { rows, people: people ?? autoPeople(plan) });
	}
	async function issuesByKey() {
		const rows = await db.select().from(issue).where(eq(issue.projectId, projectId));
		return new Map(rows.map((r) => [r.backlogKey ?? r.title, r]));
	}
	const count = async (table: typeof category | typeof issueStatus | typeof issue) =>
		(await db.select().from(table)).length;

	it('固定の CSV を取り込むと、項目・人・親子・本文が対応付けられる', async () => {
		const result = await run(fixture('issues.csv'));
		expect(result).toEqual({
			issues: 6,
			comments: 5,
			firstNumber: 1,
			lastNumber: 6,
			skipped: 1,
			created: { statuses: 1, types: 1, categories: 3, milestones: 1 }
		});
		const byKey = await issuesByKey();
		const get = (k: string) => byKey.get(k)!;
		expect(
			['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5', 'DEMO-6'].map((k) => get(k).number)
		).toEqual([1, 2, 3, 4, 5, 6]);
		const categories = new Map((await db.select().from(category)).map((c) => [c.id, c.name]));
		const milestones = new Map((await db.select().from(milestone)).map((m) => [m.id, m.name]));
		const statuses = await db
			.select()
			.from(issueStatus)
			.where(eq(issueStatus.projectId, projectId))
			.orderBy(asc(issueStatus.position));

		const d1 = get('DEMO-1');
		expect(d1.categoryIds.map((id) => categories.get(id))).toEqual(['機能A', '確定度 60%']);
		expect(milestones.get(d1.milestoneId!)).toBe('v1.0');
		expect(d1).toMatchObject({
			status: 'todo',
			priority: 'medium',
			assigneeIds: [suzuki.id],
			reporterId: 'unknown-user',
			startDate: '2024-01-15',
			dueDate: '2024-01-31',
			parentId: null
		});
		expect(d1.description).toBe(
			'（Backlog: 山田 太郎）\n\n画面の要件:\n- メールアドレス\n- パスワード\n\n"引用符"とカンマ, を含む\n\n---\n\n- Backlog から移行: DEMO-1\n- マイルストーン（Backlog）: v1.1'
		);
		expect(d1.createdAt).toEqual(new Date(2024, 0, 10, 9, 15));
		expect(d1.updatedAt).toEqual(new Date(2024, 1, 1, 18, 0));

		const d2 = get('DEMO-2');
		expect(d2).toMatchObject({ parentId: d1.id, assigneeIds: [], status: 'in_progress' });
		expect(d2.description).toBe(
			'（Backlog: 架空商事 小林）\n\n---\n\n- Backlog から移行: DEMO-2\n- 担当者（Backlog）: 山田 太郎'
		);

		expect(get('DEMO-4')).toMatchObject({
			parentId: get('DEMO-5').id,
			status: 'in_review',
			priority: 'low',
			reporterId: dev.id
		});
		expect(get('DEMO-5')).toMatchObject({
			status: 'done',
			resolution: 'fixed',
			priority: 'high',
			assigneeIds: [dev.id],
			reporterId: suzuki.id
		});

		const d3 = get('DEMO-3');
		expect(d3.parentId).toBeNull();
		expect(d3.description).toBe(
			[
				'---',
				[
					'- Backlog から移行: DEMO-3',
					'- 担当者（Backlog）: 髙田 一郎①',
					'- 親課題（Backlog）: DEMO-99',
					'- 発生バージョン: 1.0',
					'- 予定時間: 3',
					'- 実績時間: 2.5',
					'- 添付ファイル: 2 件（移行していません）'
				].join('\n')
			].join('\n\n')
		);
		expect(statuses.map((st) => st.name)).toEqual(['未着手', '進行中', 'レビュー', '保留', '完了']);
		expect(statuses.find((st) => st.name === '保留')!.key).toBe(d3.status);
		const comments3 = await db
			.select()
			.from(comment)
			.where(eq(comment.issueId, d3.id))
			.orderBy(asc(comment.createdAt), asc(comment.id));
		expect(comments3.map((c) => [c.authorId, c.body])).toEqual([
			[suzuki.id, 'よろしくお願いします'],
			['unknown-user', '（Backlog: 髙田 一郎①）\n\n調査が終わりました']
		]);
		expect(comments3[0].createdAt).toEqual(new Date(2024, 2, 1, 13, 20));

		expect(get('DEMO-6')).toMatchObject({ parentId: null });
		expect(get('DEMO-6').description).toContain('- 親課題（Backlog）: DEMO-2');

		const joined = await db
			.select()
			.from(projectMember)
			.where(eq(projectMember.projectId, projectId));
		expect(joined.map((m) => m.userId).sort()).toEqual([suzuki.id, dev.id].sort());
		expect(await db.select().from(notification)).toEqual([]);
		expect(await db.select().from(issueChange)).toEqual([]);
		expect(base.sent).toEqual([]);
		const [unknown] = await db.select().from(user).where(eq(user.id, 'unknown-user'));
		expect(unknown.name).toBe('不明なユーザー');
	});

	it('課題がある既存のプロジェクトでは、番号と並びの続きから入る', async () => {
		await createIssue(ctx(), 'DEMO', { title: '既存 1' });
		await createIssue(ctx(), 'DEMO', { title: '既存 2' });
		const result = await run([row(), row()]);
		expect([result.firstNumber, result.lastNumber]).toEqual([3, 4]);
		const byKey = await issuesByKey();
		expect(byKey.get('DEMO-1')!.number).toBe(3);
		expect(byKey.get('DEMO-2')!.number).toBe(4);
		expect(byKey.get('DEMO-1')!.position > byKey.get('既存 2')!.position).toBe(true);
		expect(byKey.get('DEMO-2')!.position > byKey.get('DEMO-1')!.position).toBe(true);
		const [{ nextIssueNumber }] = await db.select().from(project);
		expect(nextIssueNumber).toBe(5);
	});

	it('分けて取り込むと、前回の課題を親にし、子課題の子にはしない', async () => {
		await run(fixture('issues.csv'));
		const result = await run(fixture('issues-2.csv'));
		expect([result.firstNumber, result.lastNumber]).toEqual([7, 8]);
		const byKey = await issuesByKey();
		expect(byKey.get('DEMO-8')!.parentId).toBe(byKey.get('DEMO-1')!.id);
		expect(byKey.get('DEMO-9')!.parentId).toBeNull();
		expect(byKey.get('DEMO-9')!.description).toContain('- 親課題（Backlog）: DEMO-2');
	});

	it('取り込み済みのキーがあれば何も書かない', async () => {
		await run(fixture('issues.csv'));
		const before = [await count(issue), await count(category)];
		await expect(run(fixture('issues.csv'))).rejects.toMatchObject({
			code: 'conflict',
			message: expect.stringContaining('既に取り込んだ課題があります: DEMO-1、DEMO-2')
		});
		expect([await count(issue), await count(category)]).toEqual(before);
	});

	/** batch の直前に race を走らせる db（確認の後に別の操作が済んだ状況を作る） */
	const racingDb = (race: () => Promise<unknown>) =>
		new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === 'batch') {
					return async (stmts: Parameters<DB['batch']>[0]) => {
						await race();
						return target.batch(stmts);
					};
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

	it('検査の後に別の取り込みが済んだら、一意インデックスで止めて何も残さない', async () => {
		const rows = fixture('issues.csv');
		const plan = await planIssueImport(ctx(), 'DEMO', { rows });
		const racing = racingDb(() =>
			db.insert(issue).values({
				id: 'racer',
				projectId,
				number: 99,
				title: 'racer',
				reporterId: admin.id,
				position: 'z0',
				backlogKey: 'DEMO-3'
			})
		);
		const statusesBefore = await count(issueStatus);
		await expect(
			importIssues({ ...ctx(), db: racing }, 'DEMO', { rows, people: autoPeople(plan) })
		).rejects.toMatchObject({
			code: 'conflict',
			message: '既に取り込んだ課題があります。CSV を読み込み直してください'
		});
		expect(await count(issue)).toBe(1);
		expect(await count(category)).toBe(0);
		expect(await count(issueStatus)).toBe(statusesBefore);
		expect(await db.select().from(user).where(eq(user.id, 'unknown-user'))).toEqual([]);
		const joined = await db.select().from(projectMember).where(eq(projectMember.userId, dev.id));
		expect(joined).toEqual([]);
	});

	it.each([
		{
			label: '種別',
			add: (name: string) =>
				db.insert(issueType).values({ id: 'racer', projectId, name, position: 99 }),
			name: (p: IssueImportPlan) => p.created.types[0]
		},
		{
			label: 'カテゴリー',
			add: (name: string) => db.insert(category).values({ id: 'racer', projectId, name }),
			name: (p: IssueImportPlan) => p.created.categories[0]
		},
		{
			label: 'マイルストーン',
			add: (name: string) => db.insert(milestone).values({ id: 'racer', projectId, name }),
			name: (p: IssueImportPlan) => p.created.milestones[0]
		}
	])(
		'確認の後に同じ名前の $label が追加されたら、何も書かずにそう伝える',
		async ({ label, add, name }) => {
			const rows = fixture('issues.csv');
			const plan = await planIssueImport(ctx(), 'DEMO', { rows });
			const racing = racingDb(() => add(name(plan)));
			await expect(
				importIssues({ ...ctx(), db: racing }, 'DEMO', { rows, people: autoPeople(plan) })
			).rejects.toMatchObject({
				code: 'conflict',
				message: `取り込み中に同じ名前の${label}が追加されたため、何も書き込んでいません。CSV を読み込み直してください`
			});
			expect(await count(issue)).toBe(0);
		}
	);

	it('対応先を手で選べ、候補にない人は validation', async () => {
		const rows = fixture('issues.csv');
		const plan = await planIssueImport(ctx(), 'DEMO', { rows });
		const people = autoPeople(plan).map((x) =>
			x.name === '架空商事 小林' ? { ...x, userId: admin.id } : x
		);
		const disabled = await seedUser(db, 'member', '無効');
		await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, disabled.id));
		await expect(
			importIssues(ctx(), 'DEMO', {
				rows,
				people: people.map((x) => (x.name === '山田 太郎' ? { ...x, userId: disabled.id } : x))
			})
		).rejects.toMatchObject({
			code: 'validation',
			message: '対応先のユーザーが見つかりません（山田 太郎）'
		});
		await importIssues(ctx(), 'DEMO', { rows, people });
		const d2 = (await issuesByKey()).get('DEMO-2')!;
		expect(d2.reporterId).toBe(admin.id);
		expect(d2.description).not.toContain('（Backlog:');
	});

	it('取り込める課題がなければ validation', async () => {
		await expect(run([row({ title: '' })])).rejects.toMatchObject({
			code: 'validation',
			message: '取り込める課題がありません'
		});
	});

	it('同じミリ秒に作ったカテゴリーも、作った順に並ぶ', async () => {
		await run(fixture('issues.csv'));
		expect((await listCategories(ctx(), 'DEMO')).map((c) => c.name)).toEqual([
			'機能A',
			'確定度 60%',
			'機能B'
		]);
	});
});
