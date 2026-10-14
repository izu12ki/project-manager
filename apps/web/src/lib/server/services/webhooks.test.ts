import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { addWebhook, listWebhooks, maskUrl, removeWebhook, testWebhook } from './webhooks';

const URL1 = 'https://hooks.slack.com/services/T000/B000/abcdef123456';

describe('webhooks', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let admin: Actor, member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'OTHER' });
	});

	it('admin は追加・一覧・削除できる。一覧の URL はマスクする', async () => {
		await addWebhook(as(admin), 'ACME', { provider: 'slack', url: ` ${URL1} ` });
		const [w] = await listWebhooks(as(admin), 'ACME');
		expect(w).toMatchObject({
			provider: 'slack',
			providerLabel: 'Slack',
			maskedUrl: '••••••••••••123456'
		});
		expect(JSON.stringify(w)).not.toContain('T000');
		await removeWebhook(as(admin), 'ACME', w.id);
		expect(await listWebhooks(as(admin), 'ACME')).toEqual([]);
	});

	it('admin 以外は一覧も含めて forbidden', async () => {
		for (const a of [member, guest]) {
			await expect(listWebhooks(as(a), 'ACME')).rejects.toMatchObject({ code: 'forbidden' });
			await expect(
				addWebhook(as(a), 'ACME', { provider: 'slack', url: URL1 })
			).rejects.toMatchObject({
				code: 'forbidden'
			});
		}
	});

	it('URL の形式が違えば url フィールドの validation', async () => {
		for (const url of ['http://hooks.slack.com/services/x', 'https://example.com/services/x', '']) {
			await expect(addWebhook(as(admin), 'ACME', { provider: 'slack', url })).rejects.toMatchObject(
				{
					code: 'validation',
					fields: { url: [expect.any(String)] }
				}
			);
		}
		await expect(
			addWebhook(as(admin), 'ACME', { provider: 'discord', url: URL1 })
		).rejects.toMatchObject({
			code: 'validation'
		});
	});

	it('別プロジェクトの Webhook ID は not_found', async () => {
		await addWebhook(as(admin), 'OTHER', { provider: 'slack', url: URL1 });
		const [w] = await listWebhooks(as(admin), 'OTHER');
		await expect(removeWebhook(as(admin), 'ACME', w.id)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(testWebhook(as(admin), 'ACME', w.id)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('テスト送信は結果を待って返す', async () => {
		await addWebhook(as(admin), 'ACME', { provider: 'slack', url: URL1 });
		const [w] = await listWebhooks(as(admin), 'ACME');
		expect(await testWebhook(as(admin), 'ACME', w.id)).toEqual({ ok: true });
		expect(base.fetched[0].url).toBe(URL1);
		base.fetch = async () => new Response('no_service', { status: 404 });
		expect(await testWebhook(as(admin), 'ACME', w.id)).toEqual({ ok: false, error: 'HTTP 404' });
	});

	it('maskUrl は末尾 6 文字だけ残す', () => {
		expect(maskUrl('abc')).toBe('••••••••••••abc');
	});
});
