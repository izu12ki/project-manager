import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { NO_PASSWORD_KEY } from '#lib/password-key.ts';
import { resetPasswordEmail } from '#lib/server/auth.ts';
import { PasswordKeySchema } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const token = url.searchParams.get('token');
	const invalid = url.searchParams.get('error') === 'INVALID_TOKEN';
	// 新しいパスワードの鍵はメールアドレスをソルトにして作るので、トークンの持ち主を画面に渡す
	const email = token && !invalid ? await resetPasswordEmail(locals.auth, token) : null;
	return { token, email };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const token = String(fd.get('token') ?? '');
		const newPassword = fd.get('passwordKey');
		if (!v.is(PasswordKeySchema, newPassword)) return fail(400, { message: NO_PASSWORD_KEY });
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
