import { error } from '@sveltejs/kit';
import { appContext } from '$lib/server/context';
import { handleAction, handleLoad } from '$lib/server/errors';
import {
	createInvitation,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from '$lib/server/services/invitations';
import {
	createCategory,
	createMilestone,
	deleteCategory,
	deleteMilestone,
	listCategories,
	listMilestones,
	setMilestoneCompleted,
	updateCategory,
	updateMilestone
} from '$lib/server/services/issue-fields';
import {
	addMember,
	listMembers,
	removeMember,
	requireProject,
	setProjectArchived,
	updateProject
} from '$lib/server/services/projects';
import {
	addWebhook,
	listWebhooks,
	removeWebhook,
	testWebhook,
	WEBHOOK_PROVIDER_OPTIONS
} from '$lib/server/services/webhooks';
import { listUsers } from '$lib/server/services/users';
import { formObject } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	if (ctx.actor.role !== 'admin') error(404, 'Not found');
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [members, users, invitations, categories, milestones, webhooks] = await Promise.all([
			listMembers(ctx, params.key),
			listUsers(ctx),
			listPendingInvitations(ctx, { projectId: p.id }),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key),
			listWebhooks(ctx, params.key)
		]);
		const memberIds = new Set(members.map((m) => m.id));
		const candidates = users.filter(
			(u) => !u.disabledAt && u.role !== 'admin' && !memberIds.has(u.id)
		);
		return {
			members,
			candidates,
			invitations,
			categories,
			milestones,
			webhooks,
			providerOptions: WEBHOOK_PROVIDER_OPTIONS
		};
	});
};

const idOf = async (request: Request) => String((await request.formData()).get('id') ?? '');

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await updateProject(appContext(locals), params.key, input);
			return { saved: true };
		});
	},
	archive: async ({ request, locals, params }) => {
		const archived = (await request.formData()).get('archived') === 'true';
		return handleAction(async () => {
			await setProjectArchived(appContext(locals), params.key, archived);
		});
	},
	addMember: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await addMember(appContext(locals), params.key, id);
		});
	},
	removeMember: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await removeMember(appContext(locals), params.key, id);
		});
	},
	inviteGuest: async ({ request, locals, params }) => {
		const email = String((await request.formData()).get('email') ?? '');
		return handleAction(async () => {
			const ctx = appContext(locals);
			const p = await requireProject(ctx, params.key);
			const { url } = await createInvitation(ctx, { email, role: 'guest', projectId: p.id });
			return { inviteUrl: url };
		});
	},
	reissue: async ({ request, locals }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			const { url } = await reissueInvitation(appContext(locals), id);
			return { inviteUrl: url };
		});
	},
	addCategory: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await createCategory(appContext(locals), params.key, input);
		});
	},
	updateCategory: async ({ request, locals, params }) => {
		const { id = '', ...input } = formObject(await request.formData());
		return handleAction(async () => {
			await updateCategory(appContext(locals), params.key, id, input);
		});
	},
	deleteCategory: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await deleteCategory(appContext(locals), params.key, id);
		});
	},
	addMilestone: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await createMilestone(appContext(locals), params.key, input);
		});
	},
	updateMilestone: async ({ request, locals, params }) => {
		const { id = '', ...input } = formObject(await request.formData());
		return handleAction(async () => {
			await updateMilestone(appContext(locals), params.key, id, input);
		});
	},
	completeMilestone: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const id = String(fd.get('id') ?? '');
		const completed = fd.get('completed') === 'true';
		return handleAction(async () => {
			await setMilestoneCompleted(appContext(locals), params.key, id, completed);
		});
	},
	deleteMilestone: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await deleteMilestone(appContext(locals), params.key, id);
		});
	},
	addWebhook: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await addWebhook(appContext(locals), params.key, input);
		});
	},
	removeWebhook: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await removeWebhook(appContext(locals), params.key, id);
		});
	},
	testWebhook: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			const result = await testWebhook(appContext(locals), params.key, id);
			return { testResult: { id, ...result } };
		});
	},
	revoke: async ({ request, locals }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await revokeInvitation(appContext(locals), id);
		});
	}
};
