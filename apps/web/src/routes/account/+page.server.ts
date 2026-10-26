import { fail, isActionFailure } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { appContext } from '$lib/server/context';
import { can } from '$lib/server/authz';
import { handleAction } from '$lib/server/errors';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/services/api-keys';
import { disableSlack, enableSlack, getSlackStatus } from '$lib/server/services/integrations';
import { formObject, NameSchema, parse, PasswordSchema } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	return {
		slack: await getSlackStatus(ctx),
		// API キーは管理者だけが使う。それ以外には欄ごと出さない
		apiKeys: can(ctx.actor, 'api:use') ? await listApiKeys(ctx) : null
	};
};

type FailData = { message: string; fields: Record<string, string[]> };

/** カード内にエラーを出すため、失敗結果にカードの印（slack: true など）を付ける */
async function cardAction<T, K extends 'slack' | 'apiKey'>(key: K, fn: () => Promise<T>) {
	const result = await handleAction(fn);
	if (!isActionFailure(result)) return result;
	const { message, fields } = result.data as unknown as FailData;
	return fail(result.status, { message, fields, [key]: true } as {
		message: string;
		fields: Record<string, string[]>;
	} & Record<K, true>);
}
const slackAction = <T>(fn: () => Promise<T>) => cardAction('slack', fn);
const apiKeyAction = <T>(fn: () => Promise<T>) => cardAction('apiKey', fn);

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
		}),
	createApiKey: async ({ request, locals }) =>
		apiKeyAction(async () => {
			const { token } = await createApiKey(
				appContext(locals),
				formObject(await request.formData())
			);
			return { apiKeyToken: token };
		}),
	revokeApiKey: async ({ request, locals }) =>
		apiKeyAction(async () => {
			const { id } = parse(v.object({ id: v.string() }), formObject(await request.formData()));
			await revokeApiKey(appContext(locals), id);
			return { apiKeyRevoked: true };
		})
};
