import { describe, expect, it } from 'vitest';
import { readEnv } from './env';

const ok = {
	TURSO_DATABASE_URL: 'http://127.0.0.1:8080',
	BETTER_AUTH_SECRET: 'x'.repeat(32),
	BETTER_AUTH_URL: 'http://localhost:5173'
};

describe('readEnv', () => {
	it('MAIL_PROVIDER の既定値は console', () => {
		expect(readEnv(ok).MAIL_PROVIDER).toBe('console');
	});
	it('必須値が無いと、名前が分かるエラーを投げる', () => {
		expect(() => readEnv({ ...ok, BETTER_AUTH_SECRET: undefined })).toThrow('BETTER_AUTH_SECRET');
	});
});
