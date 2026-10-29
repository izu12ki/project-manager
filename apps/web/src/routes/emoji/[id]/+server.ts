import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { openCustomEmoji } from '#lib/server/services/custom-emojis.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const { contentType, body } = await openCustomEmoji(ctx, params.id);
		// URL は id ごとなので、同じ URL の画像は変わらない
		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'private, max-age=31536000, immutable'
			}
		});
	});
};
