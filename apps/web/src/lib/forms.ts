// フォームの use:enhance は $app/forms ではなくここから使う（ESLint で $app/forms の enhance を禁止している）
import { enhance as kitEnhance, type SubmitFunction } from '$app/forms';
import { derivePasswordKey } from './password-key';
import { toast } from './toast.svelte';

type Data = Record<string, unknown> | undefined;

/**
 * 送信が終わるまで同じフォームを送り直さない SubmitFunction にする。
 * 二度押しで課題や招待が二重にできないようにするため
 */
export function once<S extends Data, F extends Data>(
	submit: SubmitFunction<S, F> = () => {}
): SubmitFunction<S, F> {
	let pending = false;
	return async (input) => {
		if (pending) return input.cancel();
		pending = true;
		let cancelled = false;
		try {
			const after = await submit({
				...input,
				cancel: () => {
					cancelled = true;
					input.cancel();
				}
			});
			if (cancelled) {
				pending = false;
				return;
			}
			return async (opts) => {
				try {
					await (after ? after(opts) : opts.update());
				} finally {
					pending = false;
				}
			};
		} catch (e) {
			pending = false;
			throw e;
		}
	};
}

/** $app/forms の enhance に、送信中の二度押しを無視する処理を足したもの */
export const enhance = <S extends Data, F extends Data>(
	form: HTMLFormElement,
	submit?: SubmitFunction<S, F>
) => kitEnhance(form, once(submit));

type PasswordKeyOptions = {
	/** ソルトに使うメールアドレス。省略するとフォームの email 欄を使う */
	email?: string;
	/** 鍵にする欄。鍵は `${name}Key` で送り、生の値は送らない */
	fields: { name: string }[];
};

/**
 * パスワードの欄を、ブラウザで作った鍵（derivePasswordKey）に置き換えて送る SubmitFunction にする。
 * 鍵を作る間（1 秒前後かかる）から送り終えるまで、送信ボタンを無効にする
 */
export function withPasswordKeys<S extends Data, F extends Data>(
	opts: PasswordKeyOptions,
	submit: SubmitFunction<S, F> = () => {}
): SubmitFunction<S, F> {
	return async (input) => {
		if (!globalThis.crypto?.subtle) {
			toast.error('この接続ではパスワードを送れません。https:// で始まる URL で開いてください');
			input.cancel();
			return;
		}
		const button = input.submitter as HTMLButtonElement | null;
		const setDisabled = (v: boolean) => {
			if (button && 'disabled' in button) button.disabled = v;
		};
		setDisabled(true);
		try {
			const email = opts.email ?? String(input.formData.get('email') ?? '');
			for (const f of opts.fields) {
				const raw = String(input.formData.get(f.name) ?? '');
				input.formData.set(`${f.name}Key`, await derivePasswordKey(email, raw));
				input.formData.delete(f.name);
			}
		} catch (e) {
			// 古いブラウザなどで鍵を作れないとき。黙って止まらないように知らせる
			console.error('derivePasswordKey failed', e);
			toast.error('パスワードを処理できませんでした。別のブラウザでお試しください');
			setDisabled(false);
			input.cancel();
			return;
		}
		let after: Awaited<ReturnType<SubmitFunction<S, F>>>;
		try {
			let cancelled = false;
			after = await submit({
				...input,
				cancel: () => {
					cancelled = true;
					input.cancel();
				}
			});
			if (cancelled) {
				setDisabled(false);
				return;
			}
		} catch (e) {
			setDisabled(false);
			throw e;
		}
		return async (o) => {
			try {
				await (after ? after(o) : o.update());
			} finally {
				setDisabled(false);
			}
		};
	};
}
