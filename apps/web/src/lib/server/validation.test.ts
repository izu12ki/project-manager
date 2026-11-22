import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
	DateOrEmptySchema,
	EmailSchema,
	emptyToNull,
	formObject,
	parse,
	PasswordKeySchema
} from './validation';
import { NO_PASSWORD_KEY } from '../password-key';

describe('validation', () => {
	it('日付は暦にあるものだけ受け付ける（空は未設定）', () => {
		for (const ok of ['', '2026-10-29', '2028-02-29', '2026-12-31']) {
			expect(v.is(DateOrEmptySchema, ok)).toBe(true);
		}
		for (const ng of ['2027-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-1-01']) {
			expect(v.is(DateOrEmptySchema, ng)).toBe(false);
		}
	});
	it('メールアドレスを trim して小文字にする', () => {
		expect(parse(EmailSchema, '  Foo@Example.COM ')).toBe('foo@example.com');
	});
	it('不正な入力は AppError(validation) をフィールド付きで投げる', () => {
		const S = v.object({ email: EmailSchema, passwordKey: PasswordKeySchema });
		try {
			parse(S, { email: 'bad', passwordKey: 'short' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(AppError);
			expect((e as AppError).code).toBe('validation');
			expect(Object.keys((e as AppError).fields ?? {})).toEqual(['email', 'passwordKey']);
		}
	});
	it('フィールドエラーのみの場合は最初のフィールドのメッセージを AppError.message にする', () => {
		const S = v.object({ passwordKey: PasswordKeySchema });
		try {
			parse(S, { passwordKey: 'short' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(AppError);
			expect((e as AppError).message).toBe(NO_PASSWORD_KEY);
		}
	});
	it('パスワードの鍵は小文字の 16 進 64 文字だけ受け付ける', () => {
		expect(v.is(PasswordKeySchema, '0123456789abcdef'.repeat(4))).toBe(true);
		for (const ng of [
			'0123456789ABCDEF'.repeat(4),
			'a'.repeat(63),
			'a'.repeat(65),
			'password-1234'
		]) {
			expect(v.is(PasswordKeySchema, ng), ng).toBe(false);
		}
	});
	it('formObject は文字列の値だけを取り出す', () => {
		const fd = new FormData();
		fd.set('a', 'x');
		fd.set('b', '');
		fd.set('f', new Blob(['x']));
		expect(formObject(fd)).toEqual({ a: 'x', b: '' });
	});
	it('emptyToNull', () => {
		expect(emptyToNull(undefined)).toBeUndefined();
		expect(emptyToNull('')).toBeNull();
		expect(emptyToNull('x')).toBe('x');
	});
});
