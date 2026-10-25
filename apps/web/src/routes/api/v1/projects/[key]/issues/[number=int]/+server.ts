import { apiHandler, readJson } from '$lib/server/api';
import { getApiIssue, toServiceInput } from '$lib/server/services/api-views';
import { updateIssue } from '$lib/server/services/issues';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, (ctx) => getApiIssue(ctx, event.params.key.toUpperCase(), event.params.number));

export const PATCH: RequestHandler = (event) =>
	apiHandler(event, async (ctx) => {
		const key = event.params.key.toUpperCase();
		await updateIssue(ctx, key, event.params.number, toServiceInput(await readJson(event.request)));
		return getApiIssue(ctx, key, event.params.number);
	});
