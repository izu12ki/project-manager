import { fail, redirect } from '@sveltejs/kit';
import { ROLE_LABEL } from '$lib/labels';
import { handleAction } from '$lib/server/errors';
import { consumeRateLimit, SIGNUP_LIMIT } from '$lib/server/ratelimit';
import { acceptInvitation, getInvitationByToken } from '$lib/server/services/invitations';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const inv = await getInvitationByToken(locals.base.db, params.token);
	return { invitation: inv && { ...inv, roleLabel: ROLE_LABEL[inv.role] } };
};

export const actions: Actions = {
	default: async ({ request, locals, params, getClientAddress }) => {
		if (
			!(await consumeRateLimit(locals.base.db, `app:signup:${getClientAddress()}`, SIGNUP_LIMIT))
		) {
			return fail(429, { message: '試行回数が多すぎます', fields: {} });
		}
		const form = formObject(await request.formData());
		const input = { ...form, token: params.token };
		return handleAction(async () => {
			const { email } = await acceptInvitation(locals.base, input);
			await locals.auth.api.signInEmail({
				body: { email, password: form.password },
				headers: request.headers
			});
			redirect(303, '/');
		});
	}
};
