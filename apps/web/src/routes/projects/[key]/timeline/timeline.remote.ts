import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '$lib/server/remote-helpers';
import { listCategories, listMilestones } from '$lib/server/services/issue-fields';
import { listTimeline, updateIssue } from '$lib/server/services/issues';
import { listAssignableUsers, requireProject } from '$lib/server/services/projects';

/** 絞り込みはクライアント側で行うので、プロジェクトの課題をすべて返す */
export const getTimeline = query(v.string(), (key) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const p = await requireProject(ctx, key);
		const [items, milestones, categories, assignees] = await Promise.all([
			listTimeline(ctx, key),
			listMilestones(ctx, key),
			listCategories(ctx, key),
			listAssignableUsers(ctx.db, p.id)
		]);
		return { ...items, milestones, categories, assignees };
	});
});

/** 開始日・期限を変える。'' は未設定。権限・前後関係・アーカイブの検査は updateIssue に任せる */
export const setIssueDates = command(
	v.object({
		key: v.string(),
		number: v.pipe(v.number(), v.integer()),
		startDate: v.string(),
		dueDate: v.string()
	}),
	({ key, number, startDate, dueDate }) =>
		runCommand(async () => {
			await updateIssue(remoteContext(), key, number, { startDate, dueDate });
			void getTimeline(key).refresh();
		})
);
