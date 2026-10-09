import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { EmailSchema, emptyToNull, formObject, parse, PasswordSchema } from './validation';

describe('validation', () => {
	it('メールアドレスを trim して小文字にする', () => {
		expect(parse(EmailSchema, '  Foo@Example.COM ')).toBe('foo@example.com');
	});
	it('不正な入力は AppError(validation) をフィールド付きで投げる', () => {
		const S = v.object({ email: EmailSchema, password: PasswordSchema });
		try {
			parse(S, { email: 'bad', password: 'short' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(AppError);
			expect((e as AppError).code).toBe('validation');
			expect(Object.keys((e as AppError).fields ?? {})).toEqual(['email', 'password']);
		}
	});
	it('フィールドエラーのみの場合は最初のフィールドのメッセージを AppError.message にする', () => {
		const S = v.object({ password: PasswordSchema });
		try {
			parse(S, { password: 'short' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(AppError);
			expect((e as AppError).message).toBe('パスワードは10文字以上にしてください');
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
