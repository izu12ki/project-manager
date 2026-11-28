import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '#lib/server/remote-helpers.ts';
import { BOARD_COLUMN_MAX } from '#lib/board-limits.ts';
import { listBoard, moveIssue } from '#lib/server/services/issues.ts';

/**
 * milestone: 絞り込むマイルストーン ID（'none' は未設定、'' は絞り込みなし）。
 * limits: 列ごとに読み込むカードの数（書いていない列は BOARD_PAGE_SIZE）
 */
const BoardRef = v.object({
	key: v.string(),
	milestone: v.string(),
	limits: v.record(
		v.string(),
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(BOARD_COLUMN_MAX))
	)
});

export const getBoard = query(BoardRef, ({ key, milestone, limits }) => {
	const ctx = remoteContext();
	return runQuery(() => listBoard(ctx, key, { milestoneId: milestone || undefined }, limits));
});

/**
 * 移動して、同じ応答で getBoard を取り直す（1 往復）。ref は移動した後に画面で使う getBoard の引数
 * （移した先の列で読み込む数を増やした分も含む。画面はこの応答を受け取ってから ref を切り替えるので、取り直しの GET は出ない）
 */
export const moveCard = command(
	v.object({
		...BoardRef.entries,
		issueId: v.string(),
		status: v.string(),
		beforeId: v.string(),
		afterId: v.string()
	}),
	({ key, milestone, limits, ...input }) =>
		runCommand(async () => {
			await moveIssue(remoteContext(), key, input);
			void getBoard({ key, milestone, limits }).refresh();
		})
);
