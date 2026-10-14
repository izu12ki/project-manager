import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import { userIntegration } from '../db/schema';
import { AppError } from '../errors';
import { channelConfig, providers } from '../notifications/channels';

const mine = (ctx: AppContext) =>
	and(eq(userIntegration.userId, ctx.actor.id), eq(userIntegration.provider, 'slack'));

export async function getSlackStatus(
	ctx: AppContext
): Promise<{ available: boolean; linked: boolean }> {
	const [row] = await ctx.db
		.select({ id: userIntegration.externalId })
		.from(userIntegration)
		.where(mine(ctx));
	return { available: channelConfig(ctx, 'slack') !== null, linked: !!row };
}

/** ログイン用メールアドレスで Slack のユーザーを探して保存し、確認 DM を送る */
export async function enableSlack(ctx: AppContext): Promise<void> {
	const cfg = channelConfig(ctx, 'slack');
	if (!cfg) throw new AppError('validation', 'Slack 連携は未設定です（管理者に連絡してください）');
	const email = ctx.actor.email;
	const found = await providers.slack.lookup(cfg, email);
	if (!found.ok) {
		if (found.reason === 'not_found')
			throw new AppError(
				'validation',
				`Slack に ${email} のアカウントが見つかりませんでした。Slack のプロフィールのメールアドレスを確認してください。`
			);
		console.error(`[slack] lookup failed: ${found.error}`);
		throw new AppError(
			'validation',
			'Slack 連携の設定に問題があります。管理者に連絡してください。'
		);
	}
	await ctx.db
		.insert(userIntegration)
		.values({ userId: ctx.actor.id, provider: 'slack', externalId: found.externalId })
		.onConflictDoUpdate({
			target: [userIntegration.userId, userIntegration.provider],
			set: { externalId: found.externalId }
		});
	const r = await providers.slack.sendWelcome(cfg, found.externalId);
	if (!r.ok) console.error(`[slack] welcome failed ${ctx.actor.id}: ${r.error}`);
}

export async function disableSlack(ctx: AppContext): Promise<void> {
	await ctx.db.delete(userIntegration).where(mine(ctx));
}
