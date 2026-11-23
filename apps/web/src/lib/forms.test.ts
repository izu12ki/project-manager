import { pbkdf2Sync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';
import { once, withPasswordKeys } from './forms';

type Input = Parameters<SubmitFunction>[0];
type After = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
type Opts = Parameters<After>[0];

const input = () => ({ cancel: vi.fn() }) as unknown as Input;
const opts = () => ({ update: vi.fn(async () => {}) }) as unknown as Opts;

describe('once', () => {
	it('送信が終わるまでは、もう一度送ろうとしても取りやめる', async () => {
		const submit = once();
		const first = (await submit(input())) as After;
		const second = input();
		expect(await submit(second)).toBeUndefined();
		expect(second.cancel).toHaveBeenCalled();
		// 終わったら（既定の update を呼んで）また送れる
		const o = opts();
		await first(o);
		expect(o.update).toHaveBeenCalled();
		const third = input();
		expect(await submit(third)).toEqual(expect.any(Function));
		expect(third.cancel).not.toHaveBeenCalled();
	});

	it('渡した処理が送信を取りやめたら、次の送信を止めない', async () => {
		let block = true;
		const submit = once(({ cancel }) => {
			if (block) cancel();
		});
		const first = input();
		expect(await submit(first)).toBeUndefined();
		expect(first.cancel).toHaveBeenCalled();
		block = false;
		const second = input();
		expect(await submit(second)).toEqual(expect.any(Function));
		expect(second.cancel).not.toHaveBeenCalled();
	});

	it('渡した処理が返したコールバックを、終わった後の処理として使う', async () => {
		const after = vi.fn(async () => {});
		const submit = once(() => after);
		const callback = (await submit(input())) as After;
		const o = opts();
		await callback(o);
		expect(after).toHaveBeenCalledWith(o);
		expect(o.update).not.toHaveBeenCalled();
	});
});

describe('withPasswordKeys', () => {
	const key = (email: string, pw: string) =>
		pbkdf2Sync(pw, `project-manager:password:${email}`, 600_000, 32, 'sha256').toString('hex');
	const submitInput = (fields: Record<string, string>) => {
		const formData = new FormData();
		for (const [k, val] of Object.entries(fields)) formData.set(k, val);
		const submitter = { disabled: false } as HTMLButtonElement;
		return { formData, submitter, cancel: vi.fn() } as unknown as Input & {
			formData: FormData;
			submitter: HTMLButtonElement;
			cancel: ReturnType<typeof vi.fn>;
		};
	};

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('生のパスワードを鍵に置き換えて送る', async () => {
		const i = submitInput({ email: 'a@example.com', password: 'password-1234' });
		await withPasswordKeys({ fields: [{ name: 'password' }] })(i);
		expect(i.formData.get('passwordKey')).toBe(key('a@example.com', 'password-1234'));
		expect(i.formData.has('password')).toBe(false);
		expect(i.cancel).not.toHaveBeenCalled();
	});

	it('keepRaw の欄は生の値も残す', async () => {
		const i = submitInput({ email: 'a@example.com', password: 'password-1234' });
		await withPasswordKeys({ fields: [{ name: 'password', keepRaw: true }] })(i);
		expect(i.formData.get('passwordKey')).toBe(key('a@example.com', 'password-1234'));
		expect(i.formData.get('password')).toBe('password-1234');
	});

	it('渡したメールアドレスをフォームの email 欄より優先してソルトにする', async () => {
		const i = submitInput({ password: 'password-1234' });
		await withPasswordKeys({ email: 'a@example.com', fields: [{ name: 'password' }] })(i);
		expect(i.formData.get('passwordKey')).toBe(key('a@example.com', 'password-1234'));
	});

	it('複数の欄をそれぞれ鍵にする', async () => {
		const i = submitInput({ currentPassword: 'old-password-1', newPassword: 'new-password-1' });
		await withPasswordKeys({
			email: 'a@example.com',
			fields: [{ name: 'currentPassword', keepRaw: true }, { name: 'newPassword' }]
		})(i);
		expect(i.formData.get('currentPasswordKey')).toBe(key('a@example.com', 'old-password-1'));
		expect(i.formData.get('newPasswordKey')).toBe(key('a@example.com', 'new-password-1'));
		expect(i.formData.get('currentPassword')).toBe('old-password-1');
		expect(i.formData.has('newPassword')).toBe(false);
	});

	it('WebCrypto が使えない（http:// で開いた）ときは送らない', async () => {
		vi.stubGlobal('crypto', undefined);
		const i = submitInput({ email: 'a@example.com', password: 'password-1234' });
		await withPasswordKeys({ fields: [{ name: 'password' }] })(i);
		expect(i.cancel).toHaveBeenCalled();
		expect(i.formData.has('passwordKey')).toBe(false);
	});

	it('鍵を作れなかったときは、例外を投げずに知らせて送らず、ボタンを戻す', async () => {
		vi.spyOn(crypto.subtle, 'deriveBits').mockRejectedValue(new Error('not supported'));
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const i = submitInput({ email: 'a@example.com', password: 'password-1234' });
		await expect(withPasswordKeys({ fields: [{ name: 'password' }] })(i)).resolves.toBeUndefined();
		expect(err).toHaveBeenCalled();
		expect(i.cancel).toHaveBeenCalled();
		expect(i.formData.has('passwordKey')).toBe(false);
		expect(i.submitter.disabled).toBe(false);
	});

	it('鍵を作って送り終えるまで送信ボタンを無効にする', async () => {
		const i = submitInput({ email: 'a@example.com', password: 'password-1234' });
		let disabledWhileSubmitting: boolean | undefined;
		const callback = (await withPasswordKeys({ fields: [{ name: 'password' }] }, () => {
			disabledWhileSubmitting = i.submitter.disabled;
		})(i)) as After;
		expect(disabledWhileSubmitting).toBe(true);
		expect(i.submitter.disabled).toBe(true);
		await callback(opts());
		expect(i.submitter.disabled).toBe(false);
	});
});
