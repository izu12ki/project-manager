// フォームの use:enhance は $app/forms ではなくここから使う（ESLint で $app/forms の enhance を禁止している）
import { enhance as kitEnhance, type SubmitFunction } from '$app/forms';

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
