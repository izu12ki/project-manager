import { fail } from '@sveltejs/kit';
import { consumeRateLimit, RESET_LIMIT } from '#lib/server/ratelimit.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!(await consumeRateLimit(locals.base.db, `app:reset:${getClientAddress()}`, RESET_LIMIT))) {
			return fail(429, { message: '試行回数が多すぎます。しばらくしてから再度お試しください' });
		}
		const email = String((await request.formData()).get('email') ?? '')
			.trim()
			.toLowerCase();
		try {
			await locals.auth.api.requestPasswordReset({
				body: { email, redirectTo: `${locals.base.baseUrl}/reset-password` }
			});
		} catch (e) {
			console.error('requestPasswordReset failed', e);
		}
		// アカウントの有無を漏らさないため、結果は常に同じ
		return { sent: true };
	}
};
