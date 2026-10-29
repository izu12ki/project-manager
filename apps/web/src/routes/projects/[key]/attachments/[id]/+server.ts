import { appContext } from '#lib/server/context.ts';
import { handleLoad } from '#lib/server/errors.ts';
import { downloadHeaders, openAttachment } from '#lib/server/services/attachments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ctx = appContext(locals);
	return handleLoad(async () => {
		// URL のキーは見ない（キーを変える前に貼ったリンクも開けるように）
		const { row, body } = await openAttachment(ctx, params.id);
		return new Response(body, { headers: downloadHeaders(row) });
	});
};
