import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize, type Actor } from '../authz';
import type { AppContext, BaseContext } from '../context';
import { apiKey, user } from '../db/schema';
import { AppError } from '../errors';
import type { Limit } from '../ratelimit';
import { randomToken, sha256Hex } from '../tokens';
import { parse } from '../validation';

/** キーごとのレート制限（key は `app:api:<apiKeyId>`） */
export const API_RATE_LIMIT: Limit = { windowMs: 60_000, max: 120 };

const TOKEN_PREFIX = 'pm_';
/** 一覧に出す先頭文字数（`pm_` + 4 文字） */
const PREFIX_LENGTH = 7;
/** lastUsedAt を更新する最小間隔 */
const LAST_USED_INTERVAL_MS = 60_000;

const CreateInput = v.object({
	name: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, 'キー名を入力してください'),
		v.maxLength(50, 'キー名は50文字以内で入力してください')
	)
});

export async function createApiKey(ctx: AppContext, input: unknown): Promise<{ token: string }> {
	authorize(ctx.actor, 'api:use');
	const data = parse(CreateInput, input);
	const token = TOKEN_PREFIX + randomToken();
	await ctx.db.insert(apiKey).values({
		id: uuidv7(),
		userId: ctx.actor.id,
		name: data.name,
		tokenHash: await sha256Hex(token),
		prefix: token.slice(0, PREFIX_LENGTH)
	});
	return { token };
}

export async function listApiKeys(ctx: AppContext) {
	return ctx.db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			prefix: apiKey.prefix,
			createdAt: apiKey.createdAt,
			lastUsedAt: apiKey.lastUsedAt
		})
		.from(apiKey)
		.where(and(eq(apiKey.userId, ctx.actor.id), isNull(apiKey.revokedAt)))
		.orderBy(desc(apiKey.createdAt), desc(apiKey.id));
}

export async function revokeApiKey(ctx: AppContext, id: string): Promise<void> {
	const rows = await ctx.db
		.update(apiKey)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKey.id, id), eq(apiKey.userId, ctx.actor.id), isNull(apiKey.revokedAt)))
		.returning({ id: apiKey.id });
	if (rows.length === 0) throw new AppError('not_found', 'APIキーが見つかりません');
}

/** 生のトークン（`Bearer ` 除去済み）から持ち主の actor を引く。無効・無効化・管理者以外は null */
export async function authenticateApiKey(
	base: BaseContext,
	token: string
): Promise<{ actor: Actor; apiKeyId: string } | null> {
	if (!token.startsWith(TOKEN_PREFIX)) return null;
	const [row] = await base.db
		.select({
			id: apiKey.id,
			lastUsedAt: apiKey.lastUsedAt,
			userId: user.id,
			name: user.name,
			email: user.email,
			role: user.role
		})
		.from(apiKey)
		.innerJoin(user, eq(user.id, apiKey.userId))
		.where(
			and(
				eq(apiKey.tokenHash, await sha256Hex(token)),
				isNull(apiKey.revokedAt),
				isNull(user.disabledAt),
				eq(user.role, 'admin')
			)
		);
	if (!row) return null;
	const now = Date.now();
	if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
		base.waitUntil(
			base.db
				.update(apiKey)
				.set({ lastUsedAt: new Date(now) })
				.where(eq(apiKey.id, row.id))
				.catch((e) => console.error('api key lastUsedAt update failed', e))
		);
	}
	return {
		actor: { id: row.userId, name: row.name, email: row.email, role: row.role },
		apiKeyId: row.id
	};
}
