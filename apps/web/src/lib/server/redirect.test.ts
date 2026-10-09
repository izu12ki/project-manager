import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
	it.each([
		['/projects/ACME?x=1', '/projects/ACME?x=1'],
		[null, '/'],
		['', '/'],
		['https://evil.example', '/'],
		['//evil.example', '/'],
		['/\\evil.example', '/'],
		['javascript:alert(1)', '/']
	])('%s → %s', (input, expected) => {
		expect(safeRedirect(input)).toBe(expected);
	});
});
