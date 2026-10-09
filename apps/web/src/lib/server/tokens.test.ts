import { describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from './tokens';

describe('tokens', () => {
	it('randomToken は 43 文字の base64url で毎回異なる', () => {
		const a = randomToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(randomToken()).not.toBe(a);
	});
	it('sha256Hex', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
