import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { userIntegration } from '../db/schema';
import { createTestDb, createTestBase, ctxOf, seedUser } from '../test-utils';
import { disableSlack, enableSlack, getSlackStatus } from './integrations';

describe('integrations (slack)', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let me: Actor;
	let lookupReply: unknown;
	const urls: string[] = [];
	const ctx = () => ctxOf(base, me);

	beforeEach(async () => {
		db = await createTestDb();
		urls.length = 0;
		lookupReply = { ok: true, user: { id: 'U1' } };
		base = createTestBase(db, {
			slackBotToken: 'xoxb-t',
			fetch: async (input) => {
				urls.push(String(input));
				const body = String(input).includes('lookupByEmail') ? lookupReply : { ok: true };
				return new Response(JSON.stringify(body), { status: 200 });
			}
		});
		me = await seedUser(db, 'guest', '太郎');
	});
	afterEach(() => vi.restoreAllMocks());

	it('トークン未設定なら available: false で、オンにできない', async () => {
		base.slackBotToken = null;
		expect(await getSlackStatus(ctx())).toEqual({ available: false, linked: false });
		await expect(enableSlack(ctx())).rejects.toThrow(
			'Slack 連携は未設定です（管理者に連絡してください）'
		);
	});

	it('オンにすると保存し、確認 DM を送る', async () => {
		await enableSlack(ctx());
		expect(await db.select().from(userIntegration)).toMatchObject([
			{ userId: me.id, provider: 'slack', externalId: 'U1' }
		]);
		expect(urls[0]).toContain('users.lookupByEmail?email=');
		expect(urls[1]).toBe('https://slack.com/api/chat.postMessage');
		expect(await getSlackStatus(ctx())).toEqual({ available: true, linked: true });
	});

	it('2 回目は ID を引き直して上書きする', async () => {
		await enableSlack(ctx());
		lookupReply = { ok: true, user: { id: 'U2' } };
		await enableSlack(ctx());
		expect(await db.select({ id: userIntegration.externalId }).from(userIntegration)).toEqual([
			{ id: 'U2' }
		]);
	});

	it('見つからなければ保存せず、メールアドレス入りの文言', async () => {
		lookupReply = { ok: false, error: 'users_not_found' };
		await expect(enableSlack(ctx())).rejects.toThrow(
			`Slack に ${me.email} のアカウントが見つかりませんでした。Slack のプロフィールのメールアドレスを確認してください。`
		);
		expect(await db.select().from(userIntegration)).toEqual([]);
	});

	it('設定不備はログに詳細を出し、利用者には管理者への連絡を促す', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		lookupReply = { ok: false, error: 'missing_scope' };
		await expect(enableSlack(ctx())).rejects.toThrow(
			'Slack 連携の設定に問題があります。管理者に連絡してください。'
		);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('missing_scope'));
	});

	it('確認 DM の失敗では保存を取り消さない', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		base.fetch = async (input) =>
			new Response(
				JSON.stringify(
					String(input).includes('lookupByEmail')
						? { ok: true, user: { id: 'U1' } }
						: { ok: false, error: 'channel_not_found' }
				)
			);
		await enableSlack(ctx());
		expect(await db.select().from(userIntegration)).toHaveLength(1);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('channel_not_found'));
	});

	it('オフにすると自分の行だけ消す', async () => {
		const other = await seedUser(db, 'member');
		await db
			.insert(userIntegration)
			.values({ userId: other.id, provider: 'slack', externalId: 'U9' });
		await enableSlack(ctx());
		await disableSlack(ctx());
		expect(await db.select({ userId: userIntegration.userId }).from(userIntegration)).toEqual([
			{ userId: other.id }
		]);
	});
});
