import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
	token: url.searchParams.get('token'),
	invalid: url.searchParams.get('error') === 'INVALID_TOKEN'
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const token = String(fd.get('token') ?? '');
		const newPassword = String(fd.get('password') ?? '');
		if (newPassword.length < 10)
			return fail(400, { message: 'パスワードは10文字以上にしてください' });
		try {
			await locals.auth.api.resetPassword({ body: { token, newPassword } });
		} catch (e) {
			if (e instanceof APIError)
				return fail(400, { message: 'リンクが無効か期限切れです。もう一度やり直してください' });
			throw e;
		}
		redirect(303, '/login');
	}
};
