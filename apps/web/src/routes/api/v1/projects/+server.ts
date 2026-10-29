import { apiHandler } from '#lib/server/api.ts';
import { listProjectSummaries } from '#lib/server/services/api-views.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, async (ctx) => ({ projects: await listProjectSummaries(ctx) }));
