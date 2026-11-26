import { appContext } from '#lib/server/context.ts';
import { handleAction } from '#lib/server/errors.ts';
import {
	createInvitation,
	reissueInvitation,
	revokeInvitation
} from '#lib/server/services/invitations.ts';
import { changeUserRole, disableUser, enableUser } from '#lib/server/services/users.ts';
import { formObject } from '#lib/server/validation.ts';
import { getUserAdminRows } from '#lib/server/services/user-admin.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return getUserAdminRows(appContext(locals));
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		const fd = await request.formData();
		const input = { ...formObject(fd), projectIds: fd.getAll('projectIds').map(String) };
		return handleAction(async () => {
			const { url, mailError } = await createInvitation(appContext(locals), input);
			return { inviteUrl: url, mailError };
		});
	},
	reissue: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			const { url } = await reissueInvitation(appContext(locals), id);
			return { inviteUrl: url };
		});
	},
	revoke: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await revokeInvitation(appContext(locals), id);
		});
	},
	disable: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await disableUser(appContext(locals), id);
		});
	},
	changeRole: async ({ request, locals }) => {
		const fd = await request.formData();
		const id = String(fd.get('id') ?? '');
		const role = fd.get('role');
		return handleAction(async () => {
			await changeUserRole(appContext(locals), id, role);
		});
	},
	enable: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await enableUser(appContext(locals), id);
		});
	}
};
