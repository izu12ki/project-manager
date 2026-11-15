import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { openProjectIconImage } from '#lib/server/services/project-icons.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const { contentType, body } = await openProjectIconImage(ctx, params.id);
		// 差し替えると id（URL）が変わるので、同じ URL の画像は変わらない
		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'private, max-age=31536000, immutable'
			}
		});
	});
};
