import type { RequestEvent } from '@sveltejs/kit';
import { apiHandler, readJson } from '#lib/server/api.ts';
import { AppError } from '#lib/server/errors.ts';
import { toBulkServiceInput } from '#lib/server/services/api-views.ts';
import { bulkCreateIssues, bulkUpdateIssues } from '#lib/server/services/issue-bulk.ts';
import type { RequestHandler } from './$types';

/** dryRun は未指定・true・false だけ受け付ける。それ以外は誤って書き込まないよう 400 */
function parseDryRun(event: RequestEvent): boolean {
	const raw = event.url.searchParams.get('dryRun');
	if (raw === null || raw === 'false') return false;
	if (raw === 'true') return true;
	const msg = 'dryRun には true か false を指定してください';
	throw new AppError('validation', msg, { dryRun: [msg] });
}

export const POST: RequestHandler = (event) =>
	apiHandler(
		event,
		async (ctx) => {
			const dryRun = parseDryRun(event);
			const body = toBulkServiceInput(await readJson(event.request), 'create');
			return bulkCreateIssues(ctx, event.params.key.toUpperCase(), body, { dryRun });
		},
		{ status: event.url.searchParams.get('dryRun') === 'true' ? 200 : 201 }
	);

export const PATCH: RequestHandler = (event) =>
	apiHandler(event, async (ctx) => {
		const dryRun = parseDryRun(event);
		const body = toBulkServiceInput(await readJson(event.request), 'bulkUpdate');
		return bulkUpdateIssues(ctx, event.params.key.toUpperCase(), body, { dryRun });
	});
