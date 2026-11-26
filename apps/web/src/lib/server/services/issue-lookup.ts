import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { issue, project, projectMember } from '../db/schema';

/**
 * 課題キー（PROJ-12）で、見られる課題を探す。Backlog の課題の URL（https://xxx.backlog.com/view/PROJ-12）の
 * ドメインだけを置き換えたリンクから開けるようにするため、Backlog から取り込んだ課題の元のキーを先に比べ、
 * なければこのツールのキー（プロジェクトのキーと番号）で探す。見つからない・見られないなら null
 */
export async function findIssueByKey(
	ctx: AppContext,
	key: string
): Promise<{ projectKey: string; number: number } | null> {
	const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d{1,9})$/.exec(key.trim());
	if (!m) return null;
	const issueKey = `${m[1].toUpperCase()}-${Number(m[2])}`;
	const byBacklogKey = eq(issue.backlogKey, issueKey);
	const [row] = await ctx.db
		.select({ projectKey: project.key, number: issue.number })
		.from(issue)
		.innerJoin(project, eq(project.id, issue.projectId))
		.leftJoin(
			projectMember,
			and(eq(projectMember.projectId, project.id), eq(projectMember.userId, ctx.actor.id))
		)
		.where(
			and(
				or(byBacklogKey, and(eq(project.key, m[1].toUpperCase()), eq(issue.number, Number(m[2])))),
				ctx.actor.role === 'admin' ? undefined : isNotNull(projectMember.userId)
			)
		)
		// 元のキーが同じ課題を、別のプロジェクトにも取り込んでいるときは、アーカイブしていないものを先にする
		.orderBy(
			desc(sql`${byBacklogKey}`),
			sql`${project.archivedAt} is not null`,
			desc(issue.createdAt)
		)
		.limit(1);
	return row ?? null;
}
