import { appContext } from '#lib/server/context.ts';
import { listProjects } from '#lib/server/services/projects.ts';
import { getUnreadCount } from '#lib/notifications.remote.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, isDataRequest }) => {
	if (!locals.user) return { user: null, projects: [] };
	// サイドバー（AppSidebar）は、サーバーでの描画中に未読数の query を呼ぶ。描画中に始めると D1 への 2 往復目になり、
	// 描画の終わりに間に合わないのでページに入らず、ブラウザがもう一度取りにいく。ページを描画するリクエストでは
	// ここで始めて、レイアウトの load と同じ 1 往復に入れる。描画中の呼び出しはこの結果を使い、ページに埋め込まれる
	// （load で呼んだだけでは埋め込まれない）。遷移の __data.json では描画しないので始めない。
	// 失敗は描画中の呼び出しが扱う（同じ結果を受け取る）ので、ここでは捨てる
	if (!isDataRequest) getUnreadCount().catch(() => {});
	const projects = await listProjects(appContext(locals));
	return {
		user: locals.user,
		projects: projects.map((p) => ({
			key: p.key,
			name: p.name,
			icon: p.icon,
			iconImageId: p.iconImageId,
			color: p.color,
			archived: !!p.archivedAt
		}))
	};
};
