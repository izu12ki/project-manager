import { apiHandler } from '$lib/server/api';
import { listProjectSummaries } from '$lib/server/services/api-views';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, async (ctx) => ({ projects: await listProjectSummaries(ctx) }));
