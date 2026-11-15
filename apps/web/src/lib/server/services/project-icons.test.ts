import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PROJECT_ICON_BYTES, projectIconUrl } from '#lib/project-icon.ts';
import { createMemoryStore } from '../attachment-store';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { openProjectIconImage, removeProjectIconImage, setProjectIconImage } from './project-icons';
import { requireProject } from './projects';

const png = (size = 8) => new File([new Uint8Array(size)], 'logo.png', { type: 'image/png' });

describe('project icon images', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let store: ReturnType<typeof createMemoryStore>;
	let admin: Actor, member: Actor, outsider: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const iconId = async () => (await requireProject(as(admin), 'ACME')).iconImageId;

	beforeEach(async () => {
		db = await createTestDb();
		store = createMemoryStore();
		base = createTestBase(db, { bucket: store });
		admin = await seedUser(db, 'admin');
		member = await seedUser(db, 'member');
		outsider = await seedUser(db, 'member', 'outsider');
		await seedProject(db, { key: 'ACME', members: [member] });
	});

	it('管理者が画像を設定すると、参加者だけがその画像を開ける', async () => {
		await setProjectIconImage(as(admin), 'ACME', png());
		const id = await iconId();
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(projectIconUrl(id!)).toBe(`/project-icons/${id}`);
		expect([...store.objects.keys()]).toEqual([`project-icon/${id}`]);
		expect((await openProjectIconImage(as(member), id!)).contentType).toBe('image/png');
		await expect(openProjectIconImage(as(outsider), id!)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(openProjectIconImage(as(member), 'missing')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('差し替えると古い画像を消し、外すと画像も消す', async () => {
		await setProjectIconImage(as(admin), 'ACME', png());
		const first = await iconId();
		await setProjectIconImage(as(admin), 'ACME', png(16));
		await Promise.all(base.pending);
		const second = await iconId();
		expect(second).not.toBe(first);
		expect([...store.objects.keys()]).toEqual([`project-icon/${second}`]);

		await removeProjectIconImage(as(admin), 'ACME');
		await Promise.all(base.pending);
		expect(await iconId()).toBeNull();
		expect(store.objects.size).toBe(0);
		await expect(openProjectIconImage(as(member), second!)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('画像でないもの・大きすぎる画像は設定できない。管理者以外は変えられない', async () => {
		const cases: [unknown, string][] = [
			[null, '画像を選択してください'],
			[new File([], 'empty.png', { type: 'image/png' }), '画像を選択してください'],
			[
				new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
				'PNG・JPEG・GIF・WebP の画像を選択してください'
			],
			[png(MAX_PROJECT_ICON_BYTES + 1), '画像は1MB以下にしてください']
		];
		for (const [file, message] of cases) {
			await expect(setProjectIconImage(as(admin), 'ACME', file)).rejects.toMatchObject({
				code: 'validation',
				message
			});
		}
		await setProjectIconImage(as(admin), 'ACME', png(MAX_PROJECT_ICON_BYTES));
		await expect(setProjectIconImage(as(member), 'ACME', png())).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(removeProjectIconImage(as(member), 'ACME')).rejects.toMatchObject({
			code: 'forbidden'
		});
		expect(store.objects.size).toBe(1);
	});
});
