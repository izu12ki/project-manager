import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { NO_PASSWORD_KEY } from '#lib/password-key.ts';
import { isLoginBlocked, recordLoginFailure, recordLoginSuccess } from '#lib/server/ratelimit.ts';
import { safeRedirect } from '#lib/server/redirect.ts';
import { needsSetup } from '#lib/server/services/setup.ts';
import { isDisabledEmail } from '#lib/server/services/users.ts';
import { PasswordKeySchema } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

const INVALID = 'メールアドレスまたはパスワードが違います';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	if (await needsSetup(locals.base.db)) redirect(303, '/setup');
};

export const actions: Actions = {
	default: async ({ request, locals, url, getClientAddress }) => {
		const fd = await request.formData();
		const email = String(fd.get('email') ?? '')
			.trim()
			.toLowerCase();
		// ブラウザで作った鍵（withPasswordKeys）。スクリプトの読み込み前に送られると届かない
		const passwordKey = fd.get('passwordKey');
		if (!v.is(PasswordKeySchema, passwordKey)) {
			return fail(400, { message: NO_PASSWORD_KEY, email });
		}

		const db = locals.base.db;
		const ip = getClientAddress();
		if (await isLoginBlocked(db, ip, email)) {
			return fail(429, {
				message: '試行回数が多すぎます。しばらくしてから再度お試しください',
				email
			});
		}
		if (await isDisabledEmail(db, email)) {
			await recordLoginFailure(db, ip, email);
			return fail(400, { message: INVALID, email });
		}

		try {
			await locals.auth.api.signInEmail({
				body: { email, password: passwordKey },
				headers: request.headers
			});
		} catch (e) {
			if (!(e instanceof APIError)) throw e;
			await recordLoginFailure(db, ip, email);
			return fail(400, { message: INVALID, email });
		}
		await recordLoginSuccess(db, ip, email);
		redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
