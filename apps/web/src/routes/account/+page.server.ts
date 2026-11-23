import { fail, isActionFailure } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import * as v from 'valibot';
import { appContext } from '#lib/server/context.ts';
import { authorize, can } from '#lib/server/authz.ts';
import { handleAction } from '#lib/server/errors.ts';
import {
	PASSWORD_CHANGE_FAILURE_LIMIT,
	passwordChangeLockedFor,
	recordPasswordChangeFailure,
	recordPasswordChangeSuccess
} from '#lib/server/ratelimit.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '#lib/server/services/api-keys.ts';
import { disableSlack, enableSlack, getSlackStatus } from '#lib/server/services/integrations.ts';
import { upgradeLegacyPassword } from '#lib/server/services/legacy-password.ts';
import { formObject, NameSchema, parse, PasswordKeySchema } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	return {
		slack: await getSlackStatus(ctx),
		// 閲覧者（公開デモの共用アカウントなど）は表示名・パスワード・通知を変えられない
		canModifyAccount: can(ctx.actor, 'account:modify'),
		// API キーは管理者だけが使う。それ以外には欄ごと出さない
		apiKeys: can(ctx.actor, 'api:use') ? await listApiKeys(ctx) : null
	};
};

type FailData = { message: string; fields: Record<string, string[]> };

/** 現在のパスワードを間違え続けてパスワードの変更をロックしたときの文言。ms はロックが解けるまでの時間 */
const lockedMessage = (ms: number) =>
	`現在のパスワードを${PASSWORD_CHANGE_FAILURE_LIMIT.max}回間違えたため、パスワードの変更を一時的にロックしています。${Math.ceil(ms / 60_000)}分後にもう一度お試しください`;

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
			authorize(appContext(locals).actor, 'account:modify');
			const { name } = parse(v.object({ name: NameSchema }), formObject(await request.formData()));
			await locals.auth.api.updateUser({ body: { name }, headers: request.headers });
			return { nameSaved: true };
		}),
	changePassword: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { actor, db } = appContext(locals);
			authorize(actor, 'account:modify');
			// 閲覧者は値によらず 404 にするため、authorize の後で確かめる
			const data = parse(
				v.object({
					currentPasswordKey: PasswordKeySchema,
					newPasswordKey: PasswordKeySchema,
					// 移行期間: 旧形式（scrypt）のハッシュを照合するための生の現在のパスワード
					currentPassword: v.optional(v.string())
				}),
				input
			);
			// 旧形式の照合（scrypt）より前に止める
			const lockedFor = await passwordChangeLockedFor(db, actor.id);
			if (lockedFor > 0) return fail(429, { message: lockedMessage(lockedFor), fields: {} });
			if (data.currentPassword) {
				await upgradeLegacyPassword(
					db,
					{ userId: actor.id },
					data.currentPassword,
					data.currentPasswordKey
				);
			}
			try {
				await locals.auth.api.changePassword({
					body: {
						currentPassword: data.currentPasswordKey,
						newPassword: data.newPasswordKey,
						revokeOtherSessions: true
					},
					headers: request.headers
				});
			} catch (e) {
				if (!(e instanceof APIError)) throw e;
				await recordPasswordChangeFailure(db, actor.id);
				// この間違いで上限に達したら、その場でロックしたことを伝える
				const nowLockedFor = await passwordChangeLockedFor(db, actor.id);
				if (nowLockedFor > 0)
					return fail(429, { message: lockedMessage(nowLockedFor), fields: {} });
				return fail(400, { message: '現在のパスワードが違います', fields: {} });
			}
			await recordPasswordChangeSuccess(db, actor.id);
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
