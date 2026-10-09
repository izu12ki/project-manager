// テスト専用。アプリのコードから import しないこと。
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import type { DB } from './db';
import { relations } from './db/schema';

export async function createTestDb(): Promise<DB> {
	const db = drizzle({ client: createClient({ url: ':memory:' }), relations });
	await migrate(db, {
		migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url))
	});
	return db as unknown as DB;
}
