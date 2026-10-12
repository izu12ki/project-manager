import { describe, expect, it } from 'vitest';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, milestoneLabel } from './labels';

describe('labels', () => {
	it('全ステータスに表示名がある', () => {
		expect(STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done']);
		for (const s of STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
	});
	it('全優先度に表示名がある', () => {
		expect(PRIORITIES).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
		for (const p of PRIORITIES) expect(PRIORITY_LABEL[p]).toBeTruthy();
	});
	it('マイルストーンはリリース日があれば併記する', () => {
		expect(milestoneLabel({ name: 'v1.0', releaseDate: '2026-11-30' })).toBe(
			'v1.0（11/30 リリース）'
		);
		expect(milestoneLabel({ name: 'バックログ', releaseDate: null })).toBe('バックログ');
	});
});
