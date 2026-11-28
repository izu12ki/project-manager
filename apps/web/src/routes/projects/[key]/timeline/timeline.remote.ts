import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '#lib/server/remote-helpers.ts';
import { listTimeline, updateIssue } from '#lib/server/services/issues.ts';

/**
 * 表示の開始日と絞り込み（'' は絞り込みなし）。完了した課題は開始日より前に終わったものを返さないので、
 * 開始日を変えると取り直す
 */
const TimelineRef = v.object({
	key: v.string(),
	from: v.pipe(v.string(), v.isoDate()),
	type: v.string(),
	status: v.string(),
	assignee: v.string(),
	category: v.string(),
	milestone: v.string()
});
type TimelineRef = v.InferOutput<typeof TimelineRef>;

export const getTimeline = query(TimelineRef, ({ key, from, ...f }) => {
	const ctx = remoteContext();
	return runQuery(() =>
		listTimeline(ctx, key, {
			from,
			filters: {
				typeId: f.type || undefined,
				status: f.status || undefined,
				assigneeId: f.assignee || undefined,
				categoryId: f.category || undefined,
				milestoneId: f.milestone || undefined
			}
		})
	);
});

/** 開始日・期限を変える。'' は未設定。権限・前後関係・アーカイブの検査は updateIssue に任せる */
export const setIssueDates = command(
	v.object({
		ref: TimelineRef,
		number: v.pipe(v.number(), v.integer()),
		startDate: v.string(),
		dueDate: v.string()
	}),
	({ ref, number, startDate, dueDate }) =>
		runCommand(async () => {
			await updateIssue(remoteContext(), ref.key, number, { startDate, dueDate });
			void getTimeline(ref satisfies TimelineRef).refresh();
		})
);
