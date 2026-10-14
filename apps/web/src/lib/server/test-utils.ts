// テスト専用。アプリのコードから import しないこと。
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { uuidv7 } from 'uuidv7';
import { createMemoryStore } from './attachment-store';
import type { Actor, Role } from './authz';
import type { AppContext, BaseContext } from './context';
import type { DB } from './db';
import { project, projectMember, relations, user } from './db/schema';
import type { MailMessage } from './mailer';

export async function createTestDb(): Promise<DB> {
	const db = drizzle({ client: createClient({ url: ':memory:' }), relations });
	await migrate(db, {
		migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url))
	});
	return db as unknown as DB;
}

export function createTestBase(
	db: DB,
	overrides: Partial<BaseContext> = {}
): BaseContext & {
	sent: MailMessage[];
	fetched: { url: string; body: unknown }[];
	pending: Promise<unknown>[];
} {
	const sent: MailMessage[] = [];
	const fetched: { url: string; body: unknown }[] = [];
	const pending: Promise<unknown>[] = [];
	return {
		db,
		mailer: {
			send: async (m) => {
				sent.push(m);
			}
		},
		bucket: createMemoryStore(),
		waitUntil: (p) => {
			pending.push(p);
		},
		fetch: async (input, init) => {
			fetched.push({ url: String(input), body: JSON.parse(String(init?.body ?? 'null')) });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		},
		slackBotToken: null,
		baseUrl: 'http://localhost:5173',
		hashPassword: async (pw) => `test-hash:${pw}`,
		sent,
		fetched,
		pending,
		...overrides
	};
}

export async function seedUser(db: DB, role: Role, name: string = role): Promise<Actor> {
	const id = uuidv7();
	const email = `${role}-${id.slice(-8)}@example.com`.toLowerCase();
	await db.insert(user).values({ id, name, email, role, emailVerified: true });
	return { id, name, email, role };
}

export async function seedProject(
	db: DB,
	opts: { key?: string; name?: string; members?: Actor[]; archived?: boolean } = {}
) {
	const id = uuidv7();
	const key = opts.key ?? 'ACME';
	await db.insert(project).values({
		id,
		key,
		name: opts.name ?? 'Acme',
		archivedAt: opts.archived ? new Date() : null
	});
	for (const m of opts.members ?? []) {
		await db.insert(projectMember).values({ projectId: id, userId: m.id });
	}
	return { id, key };
}

export function ctxOf(base: BaseContext, actor: Actor): AppContext {
	return { ...base, actor };
}
