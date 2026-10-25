import type { RequestEvent } from '@sveltejs/kit';
import { apiHandler, readJson } from '$lib/server/api';
import { toServiceInput } from '$lib/server/services/api-views';
import { bulkCreateIssues, bulkUpdateIssues } from '$lib/server/services/issue-bulk';
import type { RequestHandler } from './$types';

/** API の null（クリア）を要素ごとにサービス層の空文字へ変える */
async function readItems(request: Request): Promise<unknown> {
	const body = await readJson(request);
	const items = (body as { items?: unknown } | null)?.items;
	if (!Array.isArray(items)) return body;
	return { ...(body as object), items: items.map(toServiceInput) };
}

const isDryRun = (event: RequestEvent) => event.url.searchParams.get('dryRun') === 'true';

export const POST: RequestHandler = (event) => {
	const dryRun = isDryRun(event);
	return apiHandler(
		event,
		async (ctx) =>
			bulkCreateIssues(ctx, event.params.key.toUpperCase(), await readItems(event.request), {
				dryRun
			}),
		{ status: dryRun ? 200 : 201 }
	);
};

export const PATCH: RequestHandler = (event) =>
	apiHandler(event, async (ctx) =>
		bulkUpdateIssues(ctx, event.params.key.toUpperCase(), await readItems(event.request), {
			dryRun: isDryRun(event)
		})
	);
