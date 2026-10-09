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
		['javascript:alert(1)', '/'],
		['/\t/evil.example', '/'],
		['/\n/evil.example', '/'],
		['/\r/evil.example', '/'],
		['/\u0000evil.example', '/'],
		['/\\\\evil.example', '/'],
		['/%09/x', '/%09/x'],
		['/a?b=1#c', '/a?b=1#c']
	])('%s → %s', (input, expected) => {
		expect(safeRedirect(input)).toBe(expected);
	});
});
