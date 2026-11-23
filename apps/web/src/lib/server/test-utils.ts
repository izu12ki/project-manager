// テスト専用。アプリのコードから import しないこと。
// adapter-cloudflare が依存の解決を workerd に合わせるので、無指定だと Web 版になり :memory: を開けない
import { createClient, type Client, type InStatement } from '@libsql/client/node';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { uuidv7 } from 'uuidv7';
import { createMemoryStore } from './attachment-store';
import type { Actor, Role } from './authz';
import type { AppContext, BaseContext } from './context';
import type { DB } from './db';
import { D1_MAX_PARAMS } from './db/limits';
import { createReadBatcher } from './db/read-batch';
import { project, projectMember, relations, user } from './db/schema';
import type { MailMessage } from './mailer';
import { defaultFieldInserts } from './services/issue-fields';

/**
 * 本番の D1 にある制約をテストでも再現する。違反するクエリはテストで失敗させる。
 * - 途中で処理を挟むトランザクション（db.transaction）は使えない
 * - 1 クエリのバインド変数は D1_MAX_PARAMS 個まで
 * - LIKE のパターンは 50 バイトまで（LIKE を含む文で、50 バイトを超える文字列の変数を渡したら失敗にする）
 * - db.batch() の結果は列名をキーにした行で返る（drizzle はその値の並びを列の並びとして読む）ので、
 *   同じ名前の列（join した表の id・name など）があると値がずれる。batch の select では別名を付けること
 */
export function emulateD1(client: Client, trips: { n: number } = { n: 0 }): Client {
	const check = (stmt: InStatement) => {
		const args = typeof stmt === 'string' ? [] : (stmt.args ?? []);
		const n = Array.isArray(args) ? args.length : Object.keys(args).length;
		if (n > D1_MAX_PARAMS)
			throw new Error(`too many SQL variables: ${n} (D1 allows ${D1_MAX_PARAMS})`);
		const values = Array.isArray(args) ? args : Object.values(args);
		const sql = typeof stmt === 'string' ? stmt : stmt.sql;
		if (
			/\blike\b/i.test(sql) &&
			values.some((v) => typeof v === 'string' && new TextEncoder().encode(v).length > 50)
		)
			throw new Error('LIKE or GLOB pattern too complex (D1 allows 50 bytes)');
	};
	return new Proxy(client, {
		get(target, prop, receiver) {
			if (prop === 'transaction')
				return () => {
					throw new Error('D1 does not support interactive transactions. Use db.batch().');
				};
			if (prop === 'execute')
				return (stmt: InStatement) => {
					trips.n++;
					check(stmt);
					return target.execute(stmt);
				};
			if (prop === 'batch')
				return async (stmts: InStatement[], mode?: Parameters<Client['batch']>[1]) => {
					trips.n++;
					stmts.forEach(check);
					const results = await target.batch(stmts, mode);
					for (const r of results) {
						const dup = r.columns.find((c, i) => r.columns.indexOf(c) !== i);
						if (dup !== undefined)
							throw new Error(
								`duplicate column name "${dup}" in a batched select (D1 collapses them). Alias the column.`
							);
					}
					return results;
				};
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

const tripCounters = new WeakMap<DB, { n: number }>();

export async function createTestDb(): Promise<DB> {
	const client = createClient({ url: ':memory:' });
	// drizzle の migrator は内部でトランザクションを使うので、制約をかける前の client で流す
	await migrate(drizzle({ client }), {
		migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url))
	});
	const trips = { n: 0 };
	const db = drizzle({ client: emulateD1(client, trips), relations }) as unknown as DB;
	tripCounters.set(db, trips);
	return db;
}

/**
 * createTestDb() の DB へこれまでに送った回数（1 つのクエリも 1 回の batch も 1 回）。
 * D1 では 1 往復ごとに CPU 時間がかかるので、画面 1 つ分の読み取りが何往復かをテストで固定するのに使う
 */
export function roundTrips(db: DB): number {
	const trips = tripCounters.get(db);
	if (!trips) throw new Error('roundTrips: createTestDb() で作った DB ではありません');
	return trips.n;
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
		readBatch: createReadBatcher(db),
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
	const [statuses, types] = defaultFieldInserts(db, id);
	await statuses;
	await types;
	for (const m of opts.members ?? []) {
		await db.insert(projectMember).values({ projectId: id, userId: m.id });
	}
	return { id, key };
}

export function ctxOf(base: BaseContext, actor: Actor): AppContext {
	return { ...base, actor };
}
