import { error, redirect } from '@sveltejs/kit';
import { appContext } from '#lib/server/context.ts';
import { handleAction, handleLoad } from '#lib/server/errors.ts';
import {
	createInvitation,
	listPendingInvitations,
	reissueInvitation,
	revokeInvitation
} from '#lib/server/services/invitations.ts';
import {
	createCategory,
	createIssueType,
	createMilestone,
	createStatus,
	deleteCategory,
	deleteIssueType,
	deleteMilestone,
	deleteStatus,
	listCategories,
	listIssueTypes,
	listMilestones,
	moveIssueType,
	moveStatus,
	setMilestoneCompleted,
	updateCategory,
	updateIssueType,
	updateMilestone,
	updateStatus
} from '#lib/server/services/issue-fields.ts';
import {
	addMember,
	listMembers,
	removeMember,
	requireProject,
	setProjectArchived,
	updateProject
} from '#lib/server/services/projects.ts';
import { removeProjectIconImage, setProjectIconImage } from '#lib/server/services/project-icons.ts';
import { listUsers } from '#lib/server/services/users.ts';
import { formObject } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = appContext(locals);
	if (ctx.actor.role !== 'admin') error(404, 'Not found');
	return handleLoad(async () => {
		const p = await requireProject(ctx, params.key);
		const [members, users, invitations, issueTypes, categories, milestones] = await Promise.all([
			listMembers(ctx, params.key),
			listUsers(ctx),
			listPendingInvitations(ctx, { projectId: p.id }),
			listIssueTypes(ctx, params.key),
			listCategories(ctx, params.key),
			listMilestones(ctx, params.key)
		]);
		const memberIds = new Set(members.map((m) => m.id));
		const candidates = users.filter(
			(u) => !u.disabledAt && u.role !== 'admin' && !memberIds.has(u.id)
		);
		return {
			members,
			candidates,
			invitations,
			issueTypes,
			categories,
			milestones
		};
	});
};

const idOf = async (request: Request) => String((await request.formData()).get('id') ?? '');
const moveOf = async (request: Request) => {
	const fd = await request.formData();
	return {
		id: String(fd.get('id') ?? ''),
		dir: fd.get('dir') === 'up' ? (-1 as const) : (1 as const)
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			const { key } = await updateProject(appContext(locals), params.key, input);
			if (key !== params.key) redirect(303, `/projects/${key}/settings`);
			return { saved: true };
		});
	},
	setIconImage: async ({ request, locals, params }) => {
		const file = (await request.formData()).get('image');
		return handleAction(async () => {
			await setProjectIconImage(appContext(locals), params.key, file);
			return { saved: true };
		});
	},
	removeIconImage: async ({ locals, params }) => {
		return handleAction(async () => {
			await removeProjectIconImage(appContext(locals), params.key);
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
		const fd = await request.formData();
		const email = String(fd.get('email') ?? '');
		// プロジェクト設定から招待できるのはゲストと閲覧者だけ
		const role = fd.get('role') === 'viewer' ? 'viewer' : 'guest';
		return handleAction(async () => {
			const ctx = appContext(locals);
			const p = await requireProject(ctx, params.key);
			const { url } = await createInvitation(ctx, { email, role, projectIds: [p.id] });
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
	addStatus: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await createStatus(appContext(locals), params.key, input);
		});
	},
	updateStatus: async ({ request, locals, params }) => {
		const { id = '', ...input } = formObject(await request.formData());
		return handleAction(async () => {
			await updateStatus(appContext(locals), params.key, id, input);
		});
	},
	deleteStatus: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await deleteStatus(appContext(locals), params.key, id);
		});
	},
	moveStatus: async ({ request, locals, params }) => {
		const { id, dir } = await moveOf(request);
		return handleAction(async () => {
			await moveStatus(appContext(locals), params.key, id, dir);
		});
	},
	addIssueType: async ({ request, locals, params }) => {
		const input = formObject(await request.formData());
		return handleAction(async () => {
			await createIssueType(appContext(locals), params.key, input);
		});
	},
	updateIssueType: async ({ request, locals, params }) => {
		const { id = '', ...input } = formObject(await request.formData());
		return handleAction(async () => {
			await updateIssueType(appContext(locals), params.key, id, input);
		});
	},
	deleteIssueType: async ({ request, locals, params }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await deleteIssueType(appContext(locals), params.key, id);
		});
	},
	moveIssueType: async ({ request, locals, params }) => {
		const { id, dir } = await moveOf(request);
		return handleAction(async () => {
			await moveIssueType(appContext(locals), params.key, id, dir);
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
	revoke: async ({ request, locals }) => {
		const id = await idOf(request);
		return handleAction(async () => {
			await revokeInvitation(appContext(locals), id);
		});
	}
};
