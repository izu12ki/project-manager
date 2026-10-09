import { describe, expect, it } from 'vitest';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from './labels';

describe('labels', () => {
	it('全ステータスに表示名がある', () => {
		expect(STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done']);
		for (const s of STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
	});
	it('全優先度に表示名がある', () => {
		expect(PRIORITIES).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
		for (const p of PRIORITIES) expect(PRIORITY_LABEL[p]).toBeTruthy();
	});
});
