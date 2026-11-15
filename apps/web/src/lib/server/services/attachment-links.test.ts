import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz';
import type { DB } from '../db';
import { attachment } from '../db/schema';
import { createTestBase, createTestDb, ctxOf, seedProject, seedUser } from '../test-utils';
import { referencedAttachmentIds } from './attachment-links';
import { listAttachments, uploadAttachment } from './attachments';
import { addComment, deleteComment, editComment, listComments } from './comments';
import { createIssue, getIssue, updateIssue } from './issues';

const png = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/png' });

describe('referencedAttachmentIds', () => {
	it('添付 URL の UUID を重複なく取り出し、それ以外は無視する', () => {
		const a = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
		const b = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
		const body = `![x](/projects/ACME/attachments/${a}) [y](/projects/ACME/attachments/${b})
[again](/projects/ACME/attachments/${a}) /projects/ACME/attachments/not-a-uuid`;
		expect(referencedAttachmentIds(body)).toEqual([a, b]);
	});
});

describe('referencedAttachmentIds のキー形式', () => {
	const a = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
	it('アンダースコアを含む長いキーの添付 URL も取り出す', () => {
		expect(referencedAttachmentIds(`![a](/projects/LONG_PROJECT_KEY_01/attachments/${a})`)).toEqual(
			[a]
		);
	});
	it('1 文字や 26 文字のキーは取り出さない', () => {
		expect(referencedAttachmentIds(`/projects/A/attachments/${a}`)).toEqual([]);
		expect(referencedAttachmentIds(`/projects/${'A'.repeat(26)}/attachments/${a}`)).toEqual([]);
	});
});

describe('attachment links', () => {
	let db: DB;
	let base: ReturnType<typeof createTestBase>;
	let member: Actor, guest: Actor;
	const as = (a: Actor) => ctxOf(base, a);
	const issueIdOf = async (n: number) => (await getIssue(as(member), 'ACME', n)).issue.id;
	const rowOf = async (id: string) =>
		(await db.select().from(attachment).where(eq(attachment.id, id)))[0];

	beforeEach(async () => {
		db = await createTestDb();
		base = createTestBase(db);
		member = await seedUser(db, 'member');
		guest = await seedUser(db, 'guest');
		await seedProject(db, { key: 'ACME', members: [member, guest] });
		await seedProject(db, { key: 'BETA', members: [member] });
	});

	it('起票時、本文で参照した自分の仮置きだけを紐付ける', async () => {
		const mine = await uploadAttachment(as(guest), 'ACME', png('mine.png'));
		const theirs = await uploadAttachment(as(member), 'ACME', png('theirs.png'));
		await createIssue(as(guest), 'ACME', {
			title: 'A',
			description: `![a](${mine.url}) ![b](${theirs.url})`
		});
		expect((await rowOf(mine.id)).issueId).toBe(await issueIdOf(1));
		expect((await rowOf(theirs.id)).issueId).toBeNull();
	});

	it('別プロジェクトの添付 ID は紐付けない', async () => {
		const beta = await uploadAttachment(as(member), 'BETA', png('b.png'));
		await createIssue(as(member), 'ACME', {
			title: 'A',
			description: `![b](/projects/ACME/attachments/${beta.id})`
		});
		expect((await rowOf(beta.id)).issueId).toBeNull();
	});

	it('他の課題に紐付き済みの添付を参照しても移らない', async () => {
		const a = await uploadAttachment(as(member), 'ACME', png('a.png'));
		await createIssue(as(member), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await createIssue(as(member), 'ACME', { title: 'B', description: `![a](${a.url})` });
		expect((await rowOf(a.id)).issueId).toBe(await issueIdOf(1));
	});

	it('説明の編集で紐付く', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const a = await uploadAttachment(as(member), 'ACME', png('a.png'));
		await updateIssue(as(member), 'ACME', 1, { description: `![a](${a.url})` });
		expect((await rowOf(a.id)).issueId).toBe(await issueIdOf(1));
	});

	it('コメントの投稿・編集で commentId も入り、コメント削除後も課題に残る', async () => {
		await createIssue(as(member), 'ACME', { title: 'A' });
		const a = await uploadAttachment(as(guest), 'ACME', png('a.png'));
		await addComment(as(guest), 'ACME', 1, { body: `![a](${a.url})` });
		const [c] = await listComments(as(guest), 'ACME', 1);
		expect(await rowOf(a.id)).toMatchObject({ issueId: await issueIdOf(1), commentId: c.id });

		const b = await uploadAttachment(as(guest), 'ACME', png('b.png'));
		await editComment(as(guest), 'ACME', 1, c.id, { body: `![b](${b.url})` });
		expect((await rowOf(b.id)).commentId).toBe(c.id);

		await deleteComment(as(guest), 'ACME', 1, c.id);
		expect(await rowOf(a.id)).toMatchObject({ issueId: await issueIdOf(1), commentId: null });
	});

	it('listAttachments は課題に紐付いた添付をアップロード者名付きで古い順に返す', async () => {
		const a = await uploadAttachment(as(guest), 'ACME', png('a.png'));
		const b = await uploadAttachment(as(member), 'ACME', png('b.png'));
		await uploadAttachment(as(member), 'ACME', png('orphan.png'));
		await createIssue(as(guest), 'ACME', { title: 'A', description: `![a](${a.url})` });
		await addComment(as(member), 'ACME', 1, { body: `[b](${b.url})` });
		const list = await listAttachments(as(member), 'ACME', 1);
		expect(list.map((x) => [x.filename, x.uploaderName])).toEqual([
			['a.png', 'guest'],
			['b.png', 'member']
		]);
	});
});
