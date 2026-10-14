import type { WebhookProviderId } from '../../db/schema';
import { slack } from './slack';
import type { WebhookProvider } from './types';

export type { WebhookProvider } from './types';

export const providers: Record<WebhookProviderId, WebhookProvider> = { slack };

export type DeliverResult = { ok: true } | { ok: false; error: string };

/** JSON を POST する。5 秒でタイムアウトし、再送しない。例外は投げない */
export async function deliver(
	fetchFn: typeof fetch,
	url: string,
	body: unknown
): Promise<DeliverResult> {
	try {
		const res = await fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(5000)
		});
		return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError')
			return { ok: false, error: 'タイムアウト' };
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
