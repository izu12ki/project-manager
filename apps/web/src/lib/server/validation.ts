import * as v from 'valibot';
import { AppError } from './errors';

export function parse<S extends v.GenericSchema>(schema: S, input: unknown): v.InferOutput<S> {
	const r = v.safeParse(schema, input);
	if (r.success) return r.output;
	const flat = v.flatten<S>(r.issues);
	const nested = (flat.nested ?? {}) as Record<string, string[]>;
	const firstFieldMessage = Object.values(nested)[0]?.[0];
	throw new AppError(
		'validation',
		flat.root?.[0] ?? firstFieldMessage ?? '入力内容を確認してください',
		nested
	);
}

export function formObject(fd: FormData): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, val] of fd.entries()) if (typeof val === 'string') out[k] = val;
	return out;
}

export function emptyToNull(s: string | undefined): string | null | undefined {
	if (s === undefined) return undefined;
	return s === '' ? null : s;
}

export const EmailSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.email('メールアドレスの形式が正しくありません')
);
export const NameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, '名前を入力してください'),
	v.maxLength(50, '名前は50文字以内で入力してください')
);
export const PasswordSchema = v.pipe(
	v.string(),
	v.minLength(10, 'パスワードは10文字以上にしてください'),
	v.maxLength(128, 'パスワードは128文字以内にしてください')
);
