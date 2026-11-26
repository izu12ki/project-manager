import { startOnServer } from '#lib/start-queries.ts';
import { getIssueDetail } from './issue.remote';
import type { PageLoad } from './$types';

// IssueView が描画中に引く課題の詳細を、レイアウトの load と同じ D1 への往復で引く（start-queries.ts）
export const load: PageLoad = ({ params }) => {
	startOnServer(() => getIssueDetail({ key: params.key, number: params.number }));
};
