import { apiHandler } from '#lib/server/api.ts';
import { getProjectDetail } from '#lib/server/services/api-views.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, (ctx) => getProjectDetail(ctx, event.params.key.toUpperCase()));
