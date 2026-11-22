import { describe, expect, it } from 'vitest';
import { DEFAULT_ISSUE_SORT, nextIssueSort, parseIssueSort, withIssueSort } from './issue-sort';

const params = (s: string) => new URLSearchParams(s);

describe('issue-sort', () => {
	it('URL の並びを読む。不正な値は既定、向きがなければその列の最初の向き', () => {
		expect(parseIssueSort(params(''))).toEqual(DEFAULT_ISSUE_SORT);
		expect(parseIssueSort(params('sort=bogus&order=asc'))).toEqual(DEFAULT_ISSUE_SORT);
		expect(parseIssueSort(params('sort=start&order=desc'))).toEqual({
			key: 'start',
			order: 'desc'
		});
		expect(parseIssueSort(params('sort=start'))).toEqual({ key: 'start', order: 'asc' });
		expect(parseIssueSort(params('sort=updated&order=x'))).toEqual({
			key: 'updated',
			order: 'desc'
		});
	});

	it('同じ列は向きを反転し、別の列はその列の最初の向き（予定は近い順、記録は新しい順）', () => {
		expect(nextIssueSort(DEFAULT_ISSUE_SORT, 'start')).toEqual({ key: 'start', order: 'asc' });
		expect(nextIssueSort(DEFAULT_ISSUE_SORT, 'due')).toEqual({ key: 'due', order: 'asc' });
		expect(nextIssueSort(DEFAULT_ISSUE_SORT, 'created')).toEqual({
			key: 'created',
			order: 'desc'
		});
		expect(nextIssueSort({ key: 'created', order: 'desc' }, 'created')).toEqual({
			key: 'created',
			order: 'asc'
		});
		expect(nextIssueSort(DEFAULT_ISSUE_SORT, 'number')).toEqual({ key: 'number', order: 'asc' });
		expect(nextIssueSort({ key: 'updated', order: 'asc' }, 'number')).toEqual(DEFAULT_ISSUE_SORT);
	});

	it('絞り込みは残して並びだけ差し替え、既定の並びは URL に出さない', () => {
		const q = params('status=todo&q=ログイン&sort=start&order=asc');
		expect(withIssueSort(q, { key: 'updated', order: 'desc' })).toBe(
			'?status=todo&q=%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3&sort=updated&order=desc'
		);
		expect(withIssueSort(q, DEFAULT_ISSUE_SORT)).toBe(
			'?status=todo&q=%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3'
		);
		expect(withIssueSort(params('sort=due&order=asc'), DEFAULT_ISSUE_SORT)).toBe('');
	});
});
