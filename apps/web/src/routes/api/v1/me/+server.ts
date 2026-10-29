import { apiHandler, apiUser } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	apiHandler(event, async (ctx) => ({ ...apiUser(ctx.actor), role: ctx.actor.role }));
