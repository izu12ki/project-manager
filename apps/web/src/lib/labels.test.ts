import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PRIORITIES,
	PRIORITY_LABEL,
	DEFAULT_STATUSES,
	STATUS_LABEL,
	formatDate,
	formatDateTime,
	milestoneLabel,
	todayJst
} from './labels';

describe('labels', () => {
	it('全ステータスに表示名がある', () => {
		expect(DEFAULT_STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done']);
		for (const s of DEFAULT_STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
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

describe('日付の表示（日本時間）', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('todayJst returns the current JST date on every call', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-23T14:59:00Z'));
		expect(todayJst()).toBe('2026-11-23');
		vi.setSystemTime(new Date('2026-11-23T15:00:00Z'));
		expect(todayJst()).toBe('2026-11-24');
	});

	it('formatDateTime and formatDate show the JST date', () => {
		const d = new Date('2026-11-23T15:04:00Z');
		expect(formatDateTime(d)).toBe('2026/11/24 00:04');
		expect(formatDate(d)).toBe('2026/11/24');
	});
});
