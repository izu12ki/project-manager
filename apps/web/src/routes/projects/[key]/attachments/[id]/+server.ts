import { appContext } from '$lib/server/context';
import { handleLoad } from '$lib/server/errors';
import { downloadHeaders, openAttachment } from '$lib/server/services/attachments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		const { row, body } = await openAttachment(ctx, params.key, params.id);
		return new Response(body, { headers: downloadHeaders(row) });
	});
};
