import { drizzle } from 'drizzle-orm/d1';
import { relations } from './schema';

export function createDb(d1: D1Database) {
	return drizzle(d1, { relations });
}

export type DB = ReturnType<typeof createDb>;
