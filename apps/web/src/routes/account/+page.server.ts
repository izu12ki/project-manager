import { fail, isActionFailure } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { appContext } from '$lib/server/context';
import { handleAction } from '$lib/server/errors';
import { disableSlack, enableSlack, getSlackStatus } from '$lib/server/services/integrations';
import { formObject, NameSchema, parse, PasswordSchema } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	slack: await getSlackStatus(appContext(locals))
});

type FailData = { message: string; fields: Record<string, string[]> };

/** Slack カード内にエラーを出すため、失敗結果に slack: true を付ける */
async function slackAction<T>(fn: () => Promise<T>) {
	const result = await handleAction(fn);
	if (!isActionFailure(result)) return result;
	const { message, fields } = result.data as unknown as FailData;
	return fail(result.status, { message, fields, slack: true as const });
}

export const actions: Actions = {
	updateName: async ({ request, locals }) =>
		handleAction(async () => {
			const { name } = parse(v.object({ name: NameSchema }), formObject(await request.formData()));
			await locals.auth.api.updateUser({ body: { name }, headers: request.headers });
			return { nameSaved: true };
		}),
	changePassword: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const data = parse(
				v.object({ currentPassword: v.string(), newPassword: PasswordSchema }),
				input
			);
			try {
				await locals.auth.api.changePassword({
					body: { ...data, revokeOtherSessions: true },
					headers: request.headers
				});
			} catch (e) {
				if (e instanceof APIError)
					return fail(400, { message: '現在のパスワードが違います', fields: {} });
				throw e;
			}
			return { passwordSaved: true };
		});
	},
	enableSlack: async ({ locals }) =>
		slackAction(async () => {
			await enableSlack(appContext(locals));
			return { slackEnabled: true };
		}),
	disableSlack: async ({ locals }) =>
		slackAction(async () => {
			await disableSlack(appContext(locals));
			return { slackDisabled: true };
		})
};
