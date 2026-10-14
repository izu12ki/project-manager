import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as v from 'valibot';
import { authorize } from '../authz';
import type { AppContext } from '../context';
import { projectWebhook, WEBHOOK_PROVIDERS, type WebhookProviderId } from '../db/schema';
import { AppError } from '../errors';
import { deliver, providers, type DeliverResult } from '../notifications/webhooks';
import { parse } from '../validation';
import { requireProject } from './projects';

export const WEBHOOK_PROVIDER_OPTIONS = WEBHOOK_PROVIDERS.map((id) => ({
	id,
	label: providers[id].label
}));

export interface WebhookView {
	id: string;
	provider: WebhookProviderId;
	providerLabel: string;
	maskedUrl: string;
	createdAt: Date;
}

/** URL は秘密情報なので末尾 6 文字だけ見せる */
export function maskUrl(url: string): string {
	return '•'.repeat(12) + url.slice(-6);
}

async function managedProject(ctx: AppContext, key: string) {
	authorize(ctx.actor, 'webhook:manage');
	return requireProject(ctx, key);
}

export async function listWebhooks(ctx: AppContext, key: string): Promise<WebhookView[]> {
	const p = await managedProject(ctx, key);
	const rows = await ctx.db
		.select()
		.from(projectWebhook)
		.where(eq(projectWebhook.projectId, p.id))
		.orderBy(asc(projectWebhook.createdAt), asc(projectWebhook.id));
	return rows.map((r) => ({
		id: r.id,
		provider: r.provider,
		providerLabel: providers[r.provider].label,
		maskedUrl: maskUrl(r.url),
		createdAt: r.createdAt
	}));
}

const AddInput = v.object({
	provider: v.picklist(WEBHOOK_PROVIDERS, '連携先を選んでください'),
	url: v.pipe(v.string(), v.trim())
});

export async function addWebhook(ctx: AppContext, key: string, input: unknown): Promise<void> {
	const p = await managedProject(ctx, key);
	const data = parse(AddInput, input);
	const provider = providers[data.provider];
	if (!provider.urlPattern.test(data.url)) {
		const msg = `${provider.label} の Webhook URL を入力してください`;
		throw new AppError('validation', msg, { url: [msg] });
	}
	await ctx.db
		.insert(projectWebhook)
		.values({ id: uuidv7(), projectId: p.id, provider: data.provider, url: data.url });
}

async function findWebhook(ctx: AppContext, key: string, id: string) {
	const p = await managedProject(ctx, key);
	const [row] = await ctx.db
		.select()
		.from(projectWebhook)
		.where(and(eq(projectWebhook.id, id), eq(projectWebhook.projectId, p.id)));
	if (!row) throw new AppError('not_found', '連携先が見つかりません');
	return { project: p, hook: row };
}

export async function removeWebhook(ctx: AppContext, key: string, id: string): Promise<void> {
	const { hook } = await findWebhook(ctx, key, id);
	await ctx.db.delete(projectWebhook).where(eq(projectWebhook.id, hook.id));
}

export async function testWebhook(
	ctx: AppContext,
	key: string,
	id: string
): Promise<DeliverResult> {
	const { project, hook } = await findWebhook(ctx, key, id);
	const body = providers[hook.provider].buildTest({ key: project.key, name: project.name });
	return deliver(ctx.fetch, hook.url, body);
}
