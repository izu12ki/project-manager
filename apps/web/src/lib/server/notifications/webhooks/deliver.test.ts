import { describe, expect, it } from 'vitest';
import { deliver } from '.';

describe('deliver', () => {
	it('JSON を POST し、2xx なら ok', async () => {
		const calls: RequestInit[] = [];
		const f: typeof fetch = async (_u, init) => {
			calls.push(init!);
			return new Response('ok');
		};
		expect(await deliver(f, 'https://x', { a: 1 })).toEqual({ ok: true });
		expect(calls[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
		expect(calls[0].signal).toBeInstanceOf(AbortSignal);
	});
	it('2xx 以外・タイムアウト・ネットワークエラーは例外にせず結果で返す', async () => {
		expect(await deliver(async () => new Response('no', { status: 404 }), 'https://x', {})).toEqual(
			{
				ok: false,
				error: 'HTTP 404'
			}
		);
		const timeout: typeof fetch = async () => {
			throw new DOMException('timed out', 'TimeoutError');
		};
		expect(await deliver(timeout, 'https://x', {})).toEqual({ ok: false, error: 'タイムアウト' });
		const down: typeof fetch = async () => {
			throw new TypeError('fetch failed');
		};
		expect(await deliver(down, 'https://x', {})).toEqual({ ok: false, error: 'fetch failed' });
	});
});
