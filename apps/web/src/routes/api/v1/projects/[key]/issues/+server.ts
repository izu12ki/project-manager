import { apiHandler, readJson } from '$lib/server/api';
import { getApiIssue, listApiIssues, toServiceInput } from '$lib/server/services/api-views';
import { createIssue } from '$lib/server/services/issues';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, (ctx) =>
		listApiIssues(ctx, event.params.key.toUpperCase(), event.url.searchParams)
	);

export const POST: RequestHandler = (event) =>
	apiHandler(
		event,
		async (ctx) => {
			const key = event.params.key.toUpperCase();
			const input = toServiceInput(await readJson(event.request));
			const { number } = await createIssue(ctx, key, input);
			return getApiIssue(ctx, key, number);
		},
		{ status: 201 }
	);
