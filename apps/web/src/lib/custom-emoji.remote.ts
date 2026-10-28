import { query } from '$app/server';
import { remoteContext, runQuery } from '$lib/server/remote-helpers';
import { listCustomEmojis } from '$lib/server/services/custom-emojis';
import type { CustomEmoji } from './custom-emoji';

/** リアクションのピッカーと表示に使う、登録済みのカスタム絵文字 */
export const getCustomEmojis = query(() =>
	runQuery(async (): Promise<CustomEmoji[]> => {
		const rows = await listCustomEmojis(remoteContext());
		return rows.map((r) => ({ name: r.name, url: r.url }));
	})
);
