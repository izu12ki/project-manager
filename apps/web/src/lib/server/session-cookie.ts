import type { Auth } from './auth';
import type { Actor, Role } from './authz';

type AuthContext = Awaited<Auth['$context']>;

/** 閲覧のリクエストのセッション。undefined はここでは決めず、better-auth の getSession に任せる */
export type SessionCookieReader = (headers: Headers) => Promise<Actor | null | undefined>;

const ROLES = new Set<string>(['admin', 'member', 'guest', 'viewer'] satisfies Role[]);

/**
 * 閲覧（GET・HEAD）のセッションを、better-auth の getSession を呼ばずに Cookie キャッシュから読む。
 * getSession は endpoint の組み立て・zod の検証・出力の整形で 1 回 0.7〜2ms かかるが、
 * Cookie キャッシュの検証そのもの（HMAC 2 回）はその一部で済む。
 *
 * better-auth 1.7 の getSession が Cookie キャッシュから返す条件（src/api/routes/session.ts）を同じ鍵で確かめる:
 *  1. session_token Cookie の署名（better-call の signed cookie: `トークン.base64(HMAC-SHA256)`）
 *  2. session_data Cookie（compact: base64url の JSON { session, expiresAt, signature }）の署名
 *  3. キャッシュの session.token が 1 のトークンと一致
 *  4. version が "1"
 *  5. キャッシュの期限とセッションの期限が切れていない
 * このとき getSession は DB を読まず、Cookie も書き換えない（DB を使う設定では refreshCache が無効）。
 *
 * 返り値:
 *  - Actor: 上がすべて通った。getSession も同じ人を返す
 *  - null: session_token Cookie がない。getSession も何もせず null を返す
 *  - undefined: ここでは決めない。getSession に任せる（DB を見る、キャッシュを書き直す、壊れた Cookie を消す）
 * 受け付けるのは getSession が受け付ける場合の一部に限り、形が少しでも違えば undefined にする。
 * 迷ったら getSession に回すので、ここに誤りがあっても速くならないだけで済む向きに倒している。
 *
 * better-auth を上げて上の実装が変わると、session-cookie.test.ts の「better-auth の実装が変わっていない」が落ちる。
 * そのときは変更を読み、条件が増えていればここに足してから、テストの値を更新する
 */
export function createSessionCookieReader(authCtx: AuthContext): SessionCookieReader {
	// options の型はこのアプリの設定の形に絞られているので、better-auth の設定項目として読む
	const cache = authCtx.options.session?.cookieCache as
		{ enabled?: boolean; strategy?: string; version?: unknown } | undefined;
	const supported =
		cache?.enabled === true &&
		(cache.strategy ?? 'compact') === 'compact' &&
		cache.version === undefined &&
		authCtx.sessionConfig.cookieRefreshCache === false;
	// 前提の設定でなければ使わない（すべて getSession に任せる）
	if (!supported) return async () => undefined;

	const tokenName = authCtx.authCookies.sessionToken.name;
	const dataName = authCtx.authCookies.sessionData.name;
	// HMAC の鍵は isolate ごとに 1 回だけ作る（better-auth はリクエストごとに 2 回作る）
	const key = crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(authCtx.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);

	return async (headers) => {
		const header = headers.get('cookie');
		if (!header?.includes(tokenName)) return null;
		try {
			const cookies = parseCookies(header);
			if (!cookies) return undefined;
			const token = await verifySignedCookie(cookies.get(tokenName), await key);
			if (token === undefined) return undefined;
			return await readSessionData(cookies.get(dataName), token, await key);
		} catch {
			return undefined;
		}
	};
}

/** 同じ名前の Cookie が 2 つ以上あると、どちらを読むかが better-call と食い違いうるので読まない */
function parseCookies(header: string): Map<string, string> | undefined {
	const cookies = new Map<string, string>();
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		const name = part.slice(0, eq).trim();
		if (cookies.has(name)) return undefined;
		cookies.set(name, part.slice(eq + 1).trim());
	}
	return cookies;
}

/** better-call の getSignedCookie と同じ形（`値.署名`、署名は base64 で 44 文字）。値の URL エンコードを戻して確かめる */
async function verifySignedCookie(raw: string | undefined, key: CryptoKey) {
	if (!raw || raw.startsWith('"')) return undefined;
	const value = raw.includes('%') ? decodeURIComponent(raw) : raw;
	const dot = value.lastIndexOf('.');
	if (dot < 1) return undefined;
	const token = value.slice(0, dot);
	const signature = value.slice(dot + 1);
	if (signature.length !== 44 || !signature.endsWith('=')) return undefined;
	const ok = await crypto.subtle.verify(
		'HMAC',
		key,
		base64ToBytes(signature),
		new TextEncoder().encode(token)
	);
	return ok ? token : undefined;
}

async function readSessionData(
	raw: string | undefined,
	token: string,
	key: CryptoKey
): Promise<Actor | undefined> {
	// 分割された Cookie（名前.0, 名前.1, …）は読まない。この表の行は小さいので分割されない
	if (!raw || raw.startsWith('"')) return undefined;
	const outer: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(raw)));
	if (!isRecord(outer) || !isRecord(outer.session)) return undefined;
	const { session: payload, expiresAt, signature } = outer;
	if (typeof expiresAt !== 'number' || typeof signature !== 'string') return undefined;
	const ok = await crypto.subtle.verify(
		'HMAC',
		key,
		base64ToBytes(signature),
		new TextEncoder().encode(JSON.stringify({ ...payload, expiresAt }))
	);
	if (!ok) return undefined;

	const { session, user, version } = payload;
	if (!isRecord(session) || !isRecord(user)) return undefined;
	if (session.token !== token) return undefined;
	if ((version || '1') !== '1') return undefined;
	const now = Date.now();
	if (expiresAt < now) return undefined;
	const sessionExpiresAt = new Date(session.expiresAt as string).getTime();
	if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt < now) return undefined;

	const { id, name, email, role, disabledAt } = user;
	if (typeof id !== 'string' || typeof name !== 'string' || typeof email !== 'string')
		return undefined;
	if (typeof role !== 'string' || !ROLES.has(role)) return undefined;
	// 無効化された人はセッションを消す処理が hooks にあるので任せる（Cookie に入ることはまずない）
	if (disabledAt != null) return undefined;
	return { id, name, email, role: role as Role };
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** base64 と base64url（パディングの有無を問わない）を読む。不正な文字は atob が投げる */
function base64ToBytes(s: string) {
	let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	b64 += '='.repeat((4 - (b64.length % 4)) % 4);
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}
