import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listMigrations, toD1Sql } from './d1-migrations';

const DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url));

describe('d1-migrations', () => {
	it('foreign_keys=OFF を defer_foreign_keys に置き換え、ON の行は消す', () => {
		expect(
			toD1Sql(
				'PRAGMA foreign_keys=OFF;--> statement-breakpoint\nCREATE TABLE a (x int);--> statement-breakpoint\nPRAGMA foreign_keys=ON;--> statement-breakpoint\nDROP TABLE b;'
			)
		).toBe(
			'PRAGMA defer_foreign_keys = on;--> statement-breakpoint\nCREATE TABLE a (x int);--> statement-breakpoint\nDROP TABLE b;'
		);
	});

	it('PRAGMA が無い SQL はそのまま', () => {
		const sql = 'CREATE TABLE a (x int);--> statement-breakpoint\nCREATE INDEX i ON a (x);';
		expect(toD1Sql(sql)).toBe(sql);
	});

	it('listMigrations: フォルダ名の昇順で返し、PRAGMA を変換済み', () => {
		const list = listMigrations(DIR);
		expect(list[0].name).toBe('20261009025414_init');
		expect(list.map((m) => m.name)).toEqual([...list.map((m) => m.name)].sort());
		expect(list.some((m) => m.sql.includes('PRAGMA foreign_keys'))).toBe(false);
		expect(list.filter((m) => m.sql.includes('PRAGMA defer_foreign_keys = on;'))).toHaveLength(2);
	});
});
