import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { handleAction } from '$lib/server/errors';
import { consumeRateLimit, SIGNUP_LIMIT } from '$lib/server/ratelimit';
import { createFirstAdmin, needsSetup } from '$lib/server/services/setup';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!(await needsSetup(locals.base.db))) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (
			!(await consumeRateLimit(locals.base.db, `app:signup:${getClientAddress()}`, SIGNUP_LIMIT))
		) {
			return fail(429, { message: '試行回数が多すぎます', fields: {} });
		}
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { email } = await createFirstAdmin(locals.base, input);
			try {
				await locals.auth.api.signInEmail({
					body: { email, password: input.password },
					headers: request.headers
				});
			} catch (e) {
				if (e instanceof APIError) redirect(303, '/login');
				throw e;
			}
			redirect(303, '/');
		});
	}
};
