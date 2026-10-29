import { appContext } from '#lib/server/context.ts';
import { can } from '#lib/server/authz.ts';
import { handleAction } from '#lib/server/errors.ts';
import {
	addCustomEmoji,
	deleteCustomEmoji,
	listCustomEmojis
} from '#lib/server/services/custom-emojis.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	return { emojis: await listCustomEmojis(ctx), canCreate: can(ctx.actor, 'emoji:create') };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const fd = await request.formData();
		return handleAction(async () => {
			const { name } = await addCustomEmoji(appContext(locals), {
				name: fd.get('name') ?? '',
				file: fd.get('image')
			});
			return { added: name };
		});
	},
	delete: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await deleteCustomEmoji(appContext(locals), id);
		});
	}
};
