import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';
import { relations } from './schema';

export function createDb(env: { TURSO_DATABASE_URL: string; TURSO_AUTH_TOKEN?: string }) {
	const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
	return drizzle({ client, relations });
}

export type DB = ReturnType<typeof createDb>;
