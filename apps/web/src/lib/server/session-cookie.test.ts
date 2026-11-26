import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from './auth';
import type { Actor } from './authz';
import { session } from './db/schema';
import { createFirstAdmin } from './services/setup';
import { createSessionCookieReader } from './session-cookie';
import { createTestBase, createTestDb } from './test-utils';

const KEY = 'a'.repeat(64);
const SECRET = 'test-secret-'.repeat(4);
const LOCAL = 'http://localhost:5173';

async function setup(opts: { url?: string; secret?: string } = {}) {
	const db = await createTestDb();
	const base = createTestBase(db);
	const auth = createAuth(
		{ BETTER_AUTH_SECRET: opts.secret ?? SECRET, BETTER_AUTH_URL: opts.url ?? LOCAL },
		db,
		{ mailer: base.mailer, waitUntil: base.waitUntil }
	);
	const authCtx = await auth.$context;
	base.hashPassword = (pw) => authCtx.password.hash(pw);
	await createFirstAdmin(base, { name: '管理者', email: 'admin@example.com', passwordKey: KEY });
	const read = createSessionCookieReader(authCtx);
	const names = {
		token: authCtx.authCookies.sessionToken.name,
		data: authCtx.authCookies.sessionData.name
	};

	/** ログインして、ブラウザが次に送る Cookie（名前 → 値）を返す */
	async function signIn() {
		const { headers } = await auth.api.signInEmail({
			body: { email: 'admin@example.com', password: KEY },
			returnHeaders: true
		});
		const cookies = new Map<string, string>();
		for (const c of headers.getSetCookie()) {
			const [pair] = c.split(';');
			const eq = pair.indexOf('=');
			cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
		}
		return cookies;
	}

	/**
	 * DB のセッションを消しておくと、getSession の答えは Cookie キャッシュだけで決まる
	 * （キャッシュが通れば人を返し、通らなければ DB に見に行って null）。それと比べる。
	 * getSession は session_data に base64 でない文字があると例外を投げる（'error'）
	 */
	async function compare(cookie: string | Map<string, string>) {
		await db.delete(session);
		const headers = new Headers();
		const header = typeof cookie === 'string' ? cookie : toHeader(cookie);
		if (header) headers.set('cookie', header);
		const fast = await read(headers);
		const s = await auth.api.getSession({ headers }).catch(() => 'error' as const);
		const slow: Actor | null | 'error' =
			s && s !== 'error'
				? {
						id: s.user.id,
						name: s.user.name,
						email: s.user.email,
						role: s.user.role as Actor['role']
					}
				: s;
		// ここで決めたときは getSession と同じ答えでなければならない
		if (fast !== undefined) expect(fast).toEqual(slow);
		return { fast, slow };
	}

	return { db, auth, authCtx, read, names, signIn, compare };
}

function toHeader(cookies: Map<string, string>) {
	return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** better-auth の compact 形式（setCookieCache）と同じ作り方で、任意の中身に署名する */
function signCompact(payload: Record<string, unknown>, expiresAt: number, secret = SECRET) {
	const signature = createHmac('sha256', secret)
		.update(JSON.stringify({ ...payload, expiresAt }))
		.digest('base64url');
	return Buffer.from(JSON.stringify({ session: payload, expiresAt, signature })).toString(
		'base64url'
	);
}

function decodeCompact(value: string) {
	return JSON.parse(Buffer.from(value, 'base64url').toString()) as {
		session: { session: Record<string, unknown>; user: Record<string, unknown> } & Record<
			string,
			unknown
		>;
		expiresAt: number;
	};
}

const ADMIN = { name: '管理者', email: 'admin@example.com', role: 'admin' };

afterEach(() => {
	vi.useRealTimers();
});

describe('createSessionCookieReader', () => {
	it('ログイン直後の Cookie なら、DB を見ずに getSession と同じ人を返す', async () => {
		const { signIn, compare } = await setup();
		const { fast, slow } = await compare(await signIn());
		expect(fast).toMatchObject(ADMIN);
		expect(slow).toMatchObject(ADMIN);
	});

	it('本番（https）の __Secure- の付いた名前の Cookie も読める', async () => {
		const { signIn, compare, names } = await setup({ url: 'https://pm.example.com' });
		expect(names.token.startsWith('__Secure-')).toBe(true);
		const { fast } = await compare(await signIn());
		expect(fast).toMatchObject(ADMIN);
	});

	it('session_token の Cookie がなければ null（getSession も null）', async () => {
		const { signIn, compare, names } = await setup();
		const cookies = await signIn();
		expect(await compare('')).toEqual({ fast: null, slow: null });
		expect(await compare('other=1')).toEqual({ fast: null, slow: null });
		cookies.delete(names.token);
		expect(await compare(cookies)).toEqual({ fast: null, slow: null });
	});

	describe('形が違う・改ざんされた Cookie は getSession に任せる（undefined）', () => {
		type Cookies = Map<string, string>;
		type Names = { token: string; data: string };
		const cases: [string, (c: Cookies, n: Names) => string | Cookies][] = [
			['session_data がない（DB を見る）', (c, n) => (c.delete(n.data), c)],
			[
				'session_data の中身を 1 文字変えた',
				(c, n) => {
					const v = c.get(n.data)!;
					return c.set(n.data, v.slice(0, 20) + (v[20] === 'A' ? 'B' : 'A') + v.slice(21));
				}
			],
			[
				'session_token の署名を変えた',
				(c, n) => {
					const v = decodeURIComponent(c.get(n.token)!);
					const sig = v.slice(v.lastIndexOf('.') + 1);
					const other = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
					return c.set(n.token, encodeURIComponent(v.slice(0, -sig.length) + other));
				}
			],
			[
				'session_token の値を変えた（署名はそのまま）',
				(c, n) => c.set(n.token, 'x' + c.get(n.token)!)
			],
			// getSession は例外を投げる（今もそのまま 500 になる）
			['session_data が base64 でない', (c, n) => c.set(n.data, '!!!')],
			[
				'session_data が JSON でない',
				(c, n) => c.set(n.data, Buffer.from('not json').toString('base64url'))
			],
			[
				'session_data が分割されている（名前.0, 名前.1）',
				(c, n) => {
					const v = c.get(n.data)!;
					c.delete(n.data);
					return c.set(`${n.data}.0`, v.slice(0, 100)).set(`${n.data}.1`, v.slice(100));
				}
			],
			['同じ名前の Cookie が 2 つある', (c, n) => `${toHeader(c)}; ${n.data}=${c.get(n.data)!}`],
			['値が引用符で囲まれている', (c, n) => c.set(n.data, `"${c.get(n.data)!}"`)]
		];
		it.each(cases)('%s', async (_, mutate) => {
			const { signIn, compare, names } = await setup();
			const { fast } = await compare(mutate(await signIn(), names));
			expect(fast).toBeUndefined();
		});

		it('別のセッションの session_data と組み合わせた', async () => {
			const { signIn, compare, names } = await setup();
			const a = await signIn();
			const b = await signIn();
			a.set(names.data, b.get(names.data)!);
			expect((await compare(a)).fast).toBeUndefined();
		});

		it('別の secret で署名された Cookie', async () => {
			const { signIn, compare, names } = await setup();
			const other = await setup({ secret: 'other-secret-'.repeat(4) });
			const theirs = await other.signIn();
			expect((await compare(new Map(theirs))).fast).toBeUndefined();
			// トークンはこちらの正しいもの、session_data は別の secret のもの
			const mine = await signIn();
			mine.set(names.data, theirs.get(names.data)!);
			expect((await compare(mine)).fast).toBeUndefined();
		});
	});

	it('キャッシュの期限（5 分）を過ぎたら getSession に任せる', async () => {
		const { signIn, compare } = await setup();
		const cookies = await signIn();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 4 * 60 * 1000);
		expect((await compare(cookies)).fast).toMatchObject(ADMIN);
		vi.setSystemTime(Date.now() + 61 * 1000);
		expect(await compare(cookies)).toEqual({ fast: undefined, slow: null });
	});

	describe('正しく署名されていても、中身が条件に合わなければ getSession に任せる', () => {
		async function signed(
			edit: (p: ReturnType<typeof decodeCompact>['session']) => void,
			opts: { expiresAt?: number; secret?: string } = {}
		) {
			const ctx = await setup();
			const cookies = await ctx.signIn();
			const { session: payload, expiresAt } = decodeCompact(cookies.get(ctx.names.data)!);
			edit(payload);
			cookies.set(ctx.names.data, signCompact(payload, opts.expiresAt ?? expiresAt, opts.secret));
			return ctx.compare(cookies);
		}

		it('（比べる基準）中身を変えずに署名し直したものは受け付ける', async () => {
			const { fast, slow } = await signed(() => {});
			expect(fast).toMatchObject(ADMIN);
			expect(slow).toMatchObject(ADMIN);
		});

		it('secret を知らない人が作った中身（形もトークンも正しい）', async () => {
			const r = await signed((p) => (p.user.role = 'admin'), { secret: 'guess'.repeat(10) });
			expect(r).toEqual({ fast: undefined, slow: null });
		});

		it('セッションそのものの期限切れ', async () => {
			const r = await signed((p) => (p.session.expiresAt = new Date(Date.now() - 1000)));
			expect(r).toEqual({ fast: undefined, slow: null });
		});

		it('キャッシュの期限切れ', async () => {
			const r = await signed(() => {}, { expiresAt: Date.now() - 1000 });
			expect(r).toEqual({ fast: undefined, slow: null });
		});

		it('version が 1 でない', async () => {
			const r = await signed((p) => (p.version = '2'));
			expect(r).toEqual({ fast: undefined, slow: null });
		});

		it('トークンが session_token と違う', async () => {
			const r = await signed((p) => (p.session.token = 'other'));
			expect(r).toEqual({ fast: undefined, slow: null });
		});

		it('無効化された人（hooks がセッションを消す）', async () => {
			const r = await signed((p) => (p.user.disabledAt = new Date()));
			expect(r.fast).toBeUndefined();
			expect(r.slow).toMatchObject(ADMIN);
		});

		it('知らないロール', async () => {
			const r = await signed((p) => (p.user.role = 'owner'));
			expect(r.fast).toBeUndefined();
		});

		it('id がない', async () => {
			const r = await signed((p) => delete p.user.id);
			expect(r.fast).toBeUndefined();
		});
	});

	it('Cookie をでたらめに 1 文字変えても、getSession と違う人を返さない', async () => {
		const { signIn, compare } = await setup();
		const header = toHeader(await signIn());
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.%=;';
		// 決まった種の乱数（mulberry32）。落ちたときに同じ入力で再現できるようにする
		let seed = 20261126;
		const rand = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		let accepted = 0;
		for (let i = 0; i < 200; i++) {
			const at = Math.floor(rand() * header.length);
			const ch = chars[Math.floor(rand() * chars.length)];
			const { fast } = await compare(header.slice(0, at) + ch + header.slice(at + 1));
			if (fast) accepted++;
		}
		// 署名の外（Cookie の名前など）を変えて受け付けたものがあっても、上の compare が getSession と同じことを確かめている
		expect(accepted).toBeLessThan(200);
	});

	it('前提と違う設定（refreshCache・jwe）では使わない', async () => {
		const { authCtx, signIn } = await setup();
		const cookies = await signIn();
		const headers = new Headers({ cookie: toHeader(cookies) });
		const withRefresh = createSessionCookieReader({
			...authCtx,
			sessionConfig: {
				...authCtx.sessionConfig,
				cookieRefreshCache: { enabled: true, updateAge: 60 }
			}
		} as typeof authCtx);
		expect(await withRefresh(headers)).toBeUndefined();
		const jwe = createSessionCookieReader({
			...authCtx,
			options: {
				...authCtx.options,
				session: { cookieCache: { enabled: true, maxAge: 300, strategy: 'jwe' } }
			}
		} as typeof authCtx);
		expect(await jwe(headers)).toBeUndefined();
	});

	/**
	 * session-cookie.ts は、better-auth の getSession のうち Cookie キャッシュから返すところと同じ判定をしている。
	 * better-auth を上げてその実装が変わったら、ここが落ちる（Renovate の自動マージも止まる）。
	 * そのときは差分を読み、session-cookie.ts の条件（コメントの 1〜5）に足りないものがないか確かめてから、
	 * 下の値を新しいものに置き換える
	 */
	it('better-auth の実装（Cookie キャッシュの検証）が変わっていない', () => {
		const require = createRequire(import.meta.url);
		const authMain = require.resolve('better-auth');
		const authDist = dirname(authMain);
		const callDist = dirname(createRequire(authMain).resolve('better-call'));
		const read = (file: string) => readFileSync(file, 'utf8');
		const between = (src: string, start: string, end: string) => {
			const from = src.indexOf(start);
			const to = src.indexOf(end, from);
			if (from === -1 || to === -1) return `missing: ${start}`;
			return src.slice(from, to);
		};
		const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
		const parts = {
			getSession: between(
				read(join(authDist, 'api/routes/session.mjs')),
				'const getSession = () =>',
				'const session = await ctx.context.internalAdapter.findSession(sessionCookieToken);'
			),
			decodeCookieCache: between(
				read(join(authDist, 'cookies/index.mjs')),
				'async function decodeCookieCache(',
				'async function setSessionCookie('
			),
			cookieCachePayload: read(join(authDist, 'cookies/cache.mjs')),
			getSignedCookie: between(
				read(join(callDist, 'context.mjs')),
				'getSignedCookie:',
				'setCookie:'
			),
			verifySignature: between(
				read(join(callDist, 'crypto.mjs')),
				'const verifySignature',
				'const makeSignature'
			),
			parseCookies: between(
				read(join(callDist, 'cookies.mjs')),
				'function parseCookies(',
				'function resolveCookie('
			)
		};
		expect(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hash(v)]))).toEqual({
			getSession: '982daf866935a1cf',
			decodeCookieCache: '6a4868f8168262da',
			cookieCachePayload: 'a181f57e06f58001',
			getSignedCookie: '580da77cf4151c8e',
			verifySignature: '8532abc56e9ea1ab',
			parseCookies: '4ab2da89d9a31ec9'
		});
	});
});
