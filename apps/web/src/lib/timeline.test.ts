import { describe, expect, it } from 'vitest';
import {
	addDays,
	applyDrag,
	barSpan,
	dayCells,
	defaultFrom,
	diffDays,
	dragDelta,
	groupItems,
	isOffDay,
	mondayOf,
	parseView,
	shortDate,
	viewRange,
	lastDate,
	type TimelineIssue
} from './timeline';

describe('日付計算', () => {
	it('月末・年末・うるう年をまたいで加減算できる', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
		expect(diffDays('2026-10-10', '2026-10-05')).toBe(-5);
	});

	it('週の月曜と既定の表示開始日', () => {
		expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // 日曜
		expect(mondayOf('2026-10-12')).toBe('2026-10-12'); // 月曜
		expect(defaultFrom('2026-10-15')).toBe('2026-10-05');
	});

	it('土日と祝日を休日とみなす', () => {
		expect(isOffDay('2026-10-17')).toBe(true); // 土
		expect(isOffDay('2026-10-18')).toBe(true); // 日
		expect(isOffDay('2026-11-03')).toBe(true); // 文化の日（火）
		expect(isOffDay('2026-10-15')).toBe(false);
	});

	it('M/D 表記', () => {
		expect(shortDate('2026-01-05')).toBe('1/5');
	});
});

describe('表示範囲', () => {
	it('スケールごとの日数・幅・移動量。開始日は指定した日のまま', () => {
		expect(viewRange('2026-10-07', 'day')).toEqual({
			from: '2026-10-07',
			to: '2026-11-17',
			days: 42,
			dayWidth: 32,
			step: 21
		});
		expect(viewRange('2026-10-05', 'week')).toMatchObject({ days: 182, dayWidth: 8, step: 91 });
	});

	it('最後の日付が既定の範囲より後ろならそこまで広げる', () => {
		expect(viewRange('2026-10-05', 'day', '2026-12-18')).toMatchObject({
			to: '2026-12-18',
			days: 75
		});
		// 範囲内・範囲より前・なしは既定のまま
		expect(viewRange('2026-10-05', 'day', '2026-10-20').days).toBe(42);
		expect(viewRange('2026-10-05', 'day', '2026-09-01').days).toBe(42);
		expect(viewRange('2026-10-05', 'day', null).days).toBe(42);
		// 上限で打ち切る
		expect(viewRange('2026-10-05', 'day', '2099-01-01').days).toBe(731);
	});

	it('最後の日付は期限、なければ開始日で決める', () => {
		expect(
			lastDate([
				{ startDate: '2026-10-01', dueDate: '2026-11-01' },
				{ startDate: '2026-12-01', dueDate: null },
				{ startDate: null, dueDate: '2026-11-20' }
			])
		).toBe('2026-12-01');
		expect(lastDate([{ startDate: null, dueDate: null }])).toBeNull();
	});

	it('URL クエリの不正値は既定に戻す', () => {
		const today = '2026-10-15';
		const none = { status: '', assignee: '', category: '', milestone: '' };
		expect(parseView(new URLSearchParams(''), today)).toEqual({
			group: 'assignee',
			scale: 'day',
			from: '2026-10-05',
			filters: none
		});
		expect(
			parseView(
				new URLSearchParams(
					'group=none&scale=week&from=2026-10-08&milestone=m1&status=open&assignee=none&category=c1'
				),
				today
			)
		).toEqual({
			group: 'none',
			scale: 'week',
			from: '2026-10-08',
			filters: { status: 'open', assignee: 'none', category: 'c1', milestone: 'm1' }
		});
		for (const bad of ['from=abc', 'from=2026-02-30', 'from=2026-1-1']) {
			expect(parseView(new URLSearchParams(bad), today).from).toBe('2026-10-05');
		}
		expect(parseView(new URLSearchParams('group=x&scale=y'), today)).toMatchObject({
			group: 'assignee',
			scale: 'day'
		});
	});

	it('日ごとのセルに休日・祝日名・月の始まりを付ける', () => {
		const cells = dayCells(viewRange('2026-10-26', 'day'));
		expect(cells).toHaveLength(42);
		expect(cells[0]).toMatchObject({ date: '2026-10-26', col: 0, monthStart: true, off: false });
		expect(cells[6]).toMatchObject({ date: '2026-11-01', monthStart: true, off: true });
		expect(cells[8]).toMatchObject({ date: '2026-11-03', off: true, holiday: '文化の日' });
	});
});

describe('barSpan', () => {
	const range = viewRange('2026-10-05', 'day'); // 10/5〜11/15

	it('範囲内のバーの列', () => {
		expect(barSpan({ startDate: '2026-10-06', dueDate: '2026-10-08' }, range)).toEqual({
			kind: 'in',
			startCol: 1,
			endCol: 3,
			clippedStart: false,
			clippedEnd: false,
			missingStart: false,
			missingDue: false
		});
	});

	it('範囲の端で切り、切れた側を示す', () => {
		expect(barSpan({ startDate: '2026-09-01', dueDate: '2026-12-01' }, range)).toMatchObject({
			startCol: 0,
			endCol: 41,
			clippedStart: true,
			clippedEnd: true
		});
	});

	it('片方の日付だけなら 1 日分で、欠けた側を示す', () => {
		expect(barSpan({ startDate: null, dueDate: '2026-10-07' }, range)).toMatchObject({
			startCol: 2,
			endCol: 2,
			missingStart: true,
			missingDue: false
		});
	});

	it('範囲外は方向だけ、日付なしは null', () => {
		expect(barSpan({ startDate: '2026-09-01', dueDate: '2026-10-04' }, range)).toEqual({
			kind: 'before'
		});
		expect(barSpan({ startDate: '2026-11-16', dueDate: null }, range)).toEqual({ kind: 'after' });
		expect(barSpan({ startDate: null, dueDate: null }, range)).toBeNull();
	});
});

describe('dragDelta', () => {
	it('週表示（8px/日）ではクリック程度のぶれで日付が動かない', () => {
		for (const dx of [0, 3, 4, -3, -4]) expect(dragDelta(dx, 8)).toBe(0);
	});
	it('週表示で 1 日分動かせば 1 日', () => {
		expect(dragDelta(8, 8)).toBe(1);
		expect(dragDelta(-8, 8)).toBe(-1);
	});
	it('日表示（32px/日）で複数日', () => {
		expect(dragDelta(64, 32)).toBe(2);
		expect(dragDelta(-96, 32)).toBe(-3);
		expect(dragDelta(10, 32)).toBe(0);
	});
	it('正負で対称、-0 を返さない', () => {
		for (const w of [8, 32]) {
			for (let x = 0; x <= 200; x++) {
				expect(dragDelta(-x, w)).toBe(-dragDelta(x, w) + 0);
				expect(Object.is(dragDelta(-x, w), -0)).toBe(false);
				expect(Object.is(dragDelta(x, w), -0)).toBe(false);
			}
		}
	});
});

describe('applyDrag', () => {
	const both = { startDate: '2026-10-06', dueDate: '2026-10-08' };

	it('move は両方の日付を同じだけずらす（年をまたぐ）', () => {
		expect(applyDrag(both, 'move', 2)).toEqual({ startDate: '2026-10-08', dueDate: '2026-10-10' });
		expect(applyDrag({ startDate: '2026-12-30', dueDate: '2026-12-31' }, 'move', 2)).toEqual({
			startDate: '2027-01-01',
			dueDate: '2027-01-02'
		});
		expect(applyDrag({ startDate: null, dueDate: '2026-10-08' }, 'move', -1)).toEqual({
			startDate: null,
			dueDate: '2026-10-07'
		});
	});

	it('start / end は期限・開始日を越えない', () => {
		expect(applyDrag(both, 'start', -3)).toEqual({
			startDate: '2026-10-03',
			dueDate: '2026-10-08'
		});
		expect(applyDrag(both, 'start', 5)).toEqual({ startDate: '2026-10-08', dueDate: '2026-10-08' });
		expect(applyDrag(both, 'end', -5)).toEqual({ startDate: '2026-10-06', dueDate: '2026-10-06' });
		expect(applyDrag(both, 'end', 4)).toEqual({ startDate: '2026-10-06', dueDate: '2026-10-12' });
	});

	it('欠けている側の端を動かすとその日付を設定する', () => {
		expect(applyDrag({ startDate: null, dueDate: '2026-10-08' }, 'start', -2)).toEqual({
			startDate: '2026-10-06',
			dueDate: '2026-10-08'
		});
		expect(applyDrag({ startDate: '2026-10-06', dueDate: null }, 'end', 3)).toEqual({
			startDate: '2026-10-06',
			dueDate: '2026-10-09'
		});
		expect(applyDrag({ startDate: '2026-10-06', dueDate: null }, 'end', -3)).toEqual({
			startDate: '2026-10-06',
			dueDate: '2026-10-06'
		});
	});
});

describe('groupItems', () => {
	const issue = (
		number: number,
		startDate: string,
		opts: Partial<TimelineIssue> = {}
	): TimelineIssue => ({
		id: String(number),
		number,
		status: 'todo',
		startDate,
		dueDate: null,
		assignees: [],
		categoryIds: [],
		milestoneId: null,
		milestoneName: null,
		...opts
	});
	const items = [
		issue(1, '2026-10-05', { milestoneId: 'm2', milestoneName: 'B' }),
		issue(2, '2026-10-03', {
			assignees: [{ id: 'u2', name: 'Yamada' }],
			milestoneId: 'm1',
			milestoneName: 'A',
			status: 'done'
		}),
		issue(3, '2026-10-01', { assignees: [{ id: 'u1', name: 'Abe' }] }),
		issue(4, '2026-10-02', {
			assignees: [{ id: 'u2', name: 'Yamada' }],
			milestoneId: 'm1',
			milestoneName: 'A'
		})
	];
	const milestones = [
		{ id: 'm1', name: 'A', releaseDate: '2026-12-01' },
		{ id: 'm2', name: 'B', releaseDate: '2026-11-01' }
	];
	const summary = (gs: ReturnType<typeof groupItems>) =>
		gs.map((g) => [g.label, g.done, g.total, g.items.map((i) => i.number)]);

	it('担当者別: 名前順、未割当は最後。グループ内は開始日順', () => {
		expect(summary(groupItems(items, 'assignee', milestones))).toEqual([
			['Abe', 0, 1, [3]],
			['Yamada', 1, 2, [4, 2]],
			['未割当', 0, 1, [1]]
		]);
	});

	it('担当者別: 担当者が複数いる課題はそれぞれのグループに出る', () => {
		const shared = issue(5, '2026-10-04', {
			assignees: [
				{ id: 'u2', name: 'Yamada' },
				{ id: 'u1', name: 'Abe' }
			]
		});
		expect(summary(groupItems([...items, shared], 'assignee', milestones))).toEqual([
			['Abe', 0, 2, [3, 5]],
			['Yamada', 1, 3, [4, 2, 5]],
			['未割当', 0, 1, [1]]
		]);
	});

	it('マイルストーン別: リリース日順、マイルストーンなしは最後', () => {
		const gs = groupItems(items, 'milestone', milestones);
		expect(summary(gs)).toEqual([
			['B', 0, 1, [1]],
			['A', 1, 2, [4, 2]],
			['マイルストーンなし', 0, 1, [3]]
		]);
		expect(gs.map((g) => g.releaseDate)).toEqual(['2026-11-01', '2026-12-01', null]);
	});

	it('なし: 見出しのない 1 グループ。空なら何も返さない', () => {
		expect(summary(groupItems(items, 'none', milestones))).toEqual([[null, 1, 4, [3, 4, 2, 1]]]);
		expect(groupItems([], 'none', milestones)).toEqual([]);
	});
});
