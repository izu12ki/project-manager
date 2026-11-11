// マイグレーションでの既存データの移し替えを確かめる
import { createClient, type Client } from '@libsql/client';
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
});
