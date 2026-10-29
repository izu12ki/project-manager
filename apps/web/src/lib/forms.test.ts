import { describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';
import { once } from './forms';

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
