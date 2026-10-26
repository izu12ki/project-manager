import { apiHandler } from '$lib/server/api';
import { getProjectDetail } from '$lib/server/services/api-views';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, (ctx) => getProjectDetail(ctx, event.params.key.toUpperCase()));
