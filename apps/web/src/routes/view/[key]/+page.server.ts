import { error, redirect } from '@sveltejs/kit';
import { appContext } from '#lib/server/context.ts';
import { findIssueByKey } from '#lib/server/services/issue-lookup.ts';
import type { PageServerLoad } from './$types';

/**
 * /view/PROJ-12 を課題の画面へ転送する。Backlog の課題の URL と同じ形なので、Slack や資料に残る
 * Backlog のリンクは、ドメインをこのツールのものに置き換えれば開ける
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const found = await findIssueByKey(appContext(locals), params.key);
	if (!found) error(404, 'Not found');
	redirect(302, `/projects/${found.projectKey}/issues/${found.number}`);
};
