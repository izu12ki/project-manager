import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '#lib/server/remote-helpers.ts';
import { listBoard, moveIssue } from '#lib/server/services/issues.ts';

/** milestone: 絞り込むマイルストーン ID（'none' は未設定、'' は絞り込みなし） */
const BoardRef = v.object({ key: v.string(), milestone: v.string() });

export const getBoard = query(BoardRef, ({ key, milestone }) => {
	const ctx = remoteContext();
	return runQuery(() => listBoard(ctx, key, { milestoneId: milestone || undefined }));
});

export const moveCard = command(
	v.object({
		...BoardRef.entries,
		issueId: v.string(),
		status: v.string(),
		beforeId: v.string(),
		afterId: v.string()
	}),
	({ key, milestone, ...input }) =>
		runCommand(async () => {
			await moveIssue(remoteContext(), key, input);
			void getBoard({ key, milestone }).refresh();
		})
);
