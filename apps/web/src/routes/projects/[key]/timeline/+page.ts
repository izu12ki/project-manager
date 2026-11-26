import { todayJst } from '#lib/labels.ts';
import { startOnServer } from '#lib/start-queries.ts';
import { parseView, timelineArg } from '#lib/timeline.ts';
import { getTimeline } from './timeline.remote';
import type { PageLoad } from './$types';

// 描画中に引くタイムラインを、レイアウトの load と同じ D1 への往復で引く（start-queries.ts）
export const load: PageLoad = ({ params, url }) => {
	startOnServer(() =>
		getTimeline(timelineArg(params.key, parseView(url.searchParams, todayJst())))
	);
};
