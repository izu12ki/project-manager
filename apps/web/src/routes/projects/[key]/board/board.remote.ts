import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '$lib/server/remote-helpers';
import { listBoard, moveIssue } from '$lib/server/services/issues';

export const getBoard = query(v.string(), (key) => {
	const ctx = remoteContext();
	return runQuery(() => listBoard(ctx, key));
});

export const moveCard = command(
	v.object({
		key: v.string(),
		issueId: v.string(),
		status: v.string(),
		beforeId: v.string(),
		afterId: v.string()
	}),
	({ key, ...input }) =>
		runCommand(async () => {
			await moveIssue(remoteContext(), key, input);
			void getBoard(key).refresh();
		})
);
