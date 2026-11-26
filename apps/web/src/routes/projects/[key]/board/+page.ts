import { startOnServer } from '#lib/start-queries.ts';
import { boardArg } from './board-arg';
import { getBoard } from './board.remote';
import type { PageLoad } from './$types';

// 描画中に引くカンバンを、レイアウトの load と同じ D1 への往復で引く（start-queries.ts）
export const load: PageLoad = ({ params, url }) => {
	startOnServer(() => getBoard(boardArg(params.key, url.searchParams)));
};
