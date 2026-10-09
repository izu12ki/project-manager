import { appContext } from '$lib/server/context';
import { handleAction } from '$lib/server/errors';
import {
	createInvitation,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from '$lib/server/services/invitations';
import { listProjects } from '$lib/server/services/projects';
import { disableUser, enableUser, listUsers } from '$lib/server/services/users';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = appContext(locals);
	const [users, invitations, projects] = await Promise.all([
		listUsers(ctx),
		listPendingInvitations(ctx),
		listProjects(ctx)
	]);
	return { users, invitations, projects: projects.filter((p) => !p.archivedAt) };
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { url } = await createInvitation(appContext(locals), input);
			return { inviteUrl: url };
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
	enable: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return handleAction(async () => {
			await enableUser(appContext(locals), id);
		});
	}
};
