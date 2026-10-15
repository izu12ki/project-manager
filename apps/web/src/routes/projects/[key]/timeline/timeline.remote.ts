import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '$lib/server/remote-helpers';
import { listMilestones } from '$lib/server/services/issue-fields';
import { listTimeline, updateIssue } from '$lib/server/services/issues';

/** milestone: 絞り込むマイルストーン ID（'none' は未設定、'' は絞り込みなし） */
const TimelineRef = v.object({ key: v.string(), milestone: v.string() });

export const getTimeline = query(TimelineRef, ({ key, milestone }) => {
	const ctx = remoteContext();
	return runQuery(async () => {
		const [items, milestones] = await Promise.all([
			listTimeline(ctx, key, { milestoneId: milestone || undefined }),
			listMilestones(ctx, key)
		]);
		return { ...items, milestones };
	});
});

/** 開始日・期限を変える。'' は未設定。権限・前後関係・アーカイブの検査は updateIssue に任せる */
export const setIssueDates = command(
	v.object({
		...TimelineRef.entries,
		number: v.pipe(v.number(), v.integer()),
		startDate: v.string(),
		dueDate: v.string()
	}),
	({ key, milestone, number, startDate, dueDate }) =>
		runCommand(async () => {
			await updateIssue(remoteContext(), key, number, { startDate, dueDate });
			void getTimeline({ key, milestone }).refresh();
		})
);
