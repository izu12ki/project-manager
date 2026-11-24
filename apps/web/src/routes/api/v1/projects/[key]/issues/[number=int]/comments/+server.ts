import { apiHandler, readJson } from '#lib/server/api.ts';
import { getApiComment, listApiComments, toServiceInput } from '#lib/server/services/api-views.ts';
import { addComment } from '#lib/server/services/comments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, (ctx) =>
		listApiComments(
			ctx,
			event.params.key.toUpperCase(),
			event.params.number,
			event.url.searchParams
		)
	);

export const POST: RequestHandler = (event) =>
	apiHandler(
		event,
		async (ctx) => {
			const key = event.params.key.toUpperCase();
			const input = toServiceInput(await readJson(event.request), 'comment');
			const { id } = await addComment(ctx, key, event.params.number, input);
			return getApiComment(ctx, key, event.params.number, id);
		},
		{ status: 201 }
	);
