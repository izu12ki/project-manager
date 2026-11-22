// drizzle-kit（v1）のマイグレーション（drizzle/<名前>/migration.sql）を、
// wrangler d1 migrations apply が読める形に変換する。scripts/d1-migrations.ts から使う。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * D1 では外部キー制約を切れない（PRAGMA foreign_keys は効かない）ので、
 * drizzle がテーブルの作り直しの前後に出す PRAGMA を、制約の確認をコミット時まで遅らせる形に置き換える。
 */
export function toD1Sql(sql: string): string {
	return sql
		.replace(/^PRAGMA foreign_keys=OFF;/gm, 'PRAGMA defer_foreign_keys = on;')
		.replace(/^PRAGMA foreign_keys=ON;(--> statement-breakpoint)?\n?/gm, '');
}

/** drizzle/ のマイグレーションを名前（作成日時が先頭）の昇順で、D1 用に変換して返す */
export function listMigrations(dir: string): { name: string; sql: string }[] {
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort()
		.map((name) => ({
			name,
			sql: toD1Sql(readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'))
		}));
}
