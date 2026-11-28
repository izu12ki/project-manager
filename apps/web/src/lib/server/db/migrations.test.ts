// マイグレーションでの既存データの移し替えを確かめる
import { createClient, type Client } from '@libsql/client/node';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url));

/** 名前が suffix で終わるマイグレーションより前をすべて流し、その SQL を返す */
async function applyBefore(client: Client, suffix: string): Promise<string> {
	const folders = readdirSync(DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	const target = folders.findIndex((name) => name.endsWith(suffix));
	if (target === -1) throw new Error(`migration *${suffix} not found`);
	const sqlOf = (name: string) => readFileSync(`${DIR}/${name}/migration.sql`, 'utf8');
	for (const name of folders.slice(0, target)) await client.executeMultiple(sqlOf(name));
	return sqlOf(folders[target]);
}

describe('migrations', () => {
	it('issue_category_ids: 既存の category_id を category_ids へ移す', async () => {
		const client = createClient({ url: ':memory:' });
		const sql = await applyBefore(client, '_issue_category_ids');
		await client.executeMultiple(`
			INSERT INTO user (id, name, email) VALUES ('u1', 'u1', 'u1@example.com');
			INSERT INTO project (id, key, name) VALUES ('p1', 'ACME', 'ACME');
			INSERT INTO category (id, project_id, name) VALUES ('c1', 'p1', 'C1');
			INSERT INTO issue (id, project_id, number, title, reporter_id, position, category_id)
				VALUES ('i1', 'p1', 1, 'a', 'u1', 'a0', 'c1'), ('i2', 'p1', 2, 'b', 'u1', 'a1', NULL);
		`);
		await client.executeMultiple(sql);
		const { rows } = await client.execute(
			'SELECT id, category_ids, category_id FROM issue ORDER BY id'
		);
		expect(rows.map((r) => ({ ...r }))).toEqual([
			{ id: 'i1', category_ids: '["c1"]', category_id: 'c1' },
			{ id: 'i2', category_ids: '[]', category_id: null }
		]);
	});

	it('issue_assignee: 既存の課題の担当者を、完了かどうかと一緒に移す', async () => {
		const client = createClient({ url: ':memory:' });
		const sql = await applyBefore(client, '_issue_assignee');
		await client.executeMultiple(`
			INSERT INTO user (id, name, email) VALUES ('u1', 'u1', 'u1@example.com');
			INSERT INTO project (id, key, name) VALUES ('p1', 'ACME', 'ACME');
			INSERT INTO issue (id, project_id, number, title, reporter_id, position, status, assignee_ids)
				VALUES ('i1', 'p1', 1, 'a', 'u1', 'a0', 'todo', '["u1","u2"]'),
					('i2', 'p1', 2, 'b', 'u1', 'a1', 'done', '["u2"]'),
					('i3', 'p1', 3, 'c', 'u1', 'a2', 'todo', '[]');
		`);
		await client.executeMultiple(sql);
		const { rows } = await client.execute(
			'SELECT user_id, issue_id, done FROM issue_assignee ORDER BY issue_id, user_id'
		);
		expect(rows.map((r) => ({ ...r }))).toEqual([
			{ user_id: 'u1', issue_id: 'i1', done: 0 },
			{ user_id: 'u2', issue_id: 'i1', done: 0 },
			{ user_id: 'u2', issue_id: 'i2', done: 1 }
		]);
	});

	it('project_issue_count: 既存の課題を、削除したものを除いてプロジェクト・ステータスごとに数える', async () => {
		const client = createClient({ url: ':memory:' });
		const sql = await applyBefore(client, '_project_issue_count');
		await client.executeMultiple(`
			INSERT INTO user (id, name, email) VALUES ('u1', 'u1', 'u1@example.com');
			INSERT INTO project (id, key, name) VALUES ('p1', 'ACME', 'ACME'), ('p2', 'BETA', 'BETA');
			INSERT INTO issue (id, project_id, number, title, reporter_id, position, status, deleted_at)
				VALUES ('i1', 'p1', 1, 'a', 'u1', 'a0', 'todo', NULL),
					('i2', 'p1', 2, 'b', 'u1', 'a1', 'todo', NULL),
					('i3', 'p1', 3, 'c', 'u1', 'a2', 'done', NULL),
					('i4', 'p1', 4, 'd', 'u1', 'a3', 'done', 1795706994347),
					('i5', 'p2', 1, 'e', 'u1', 'a0', 'todo', NULL);
		`);
		await client.executeMultiple(sql);
		const { rows } = await client.execute(
			'SELECT project_id, status, n FROM project_issue_count ORDER BY project_id, status'
		);
		expect(rows.map((r) => ({ ...r }))).toEqual([
			{ project_id: 'p1', status: 'done', n: 1 },
			{ project_id: 'p1', status: 'todo', n: 2 },
			{ project_id: 'p2', status: 'todo', n: 1 }
		]);
	});
});
