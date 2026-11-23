// 手元の wrangler dev（pnpm perf:server）で、リクエストごとの CPU 時間と D1 の往復回数を測る。
//
//   node scripts/cpu-profile.ts / /projects/ACME /projects/ACME/issues/1
//   node scripts/cpu-profile.ts --email admin@example.com --password '...' --self LOGIN '/admin/users'
//
// route は `/path`、`GET /path`、`LOGIN`（ログインそのもの）。出力は route ごとの「CPU ms/回・D1 往復・ステータス」。
// --self / --incl で関数ごとの上位、--save <prefix> で .cpuprofile（Chrome DevTools の Performance で開ける）を書く。
//
// - CPU 時間は workerd の V8 インスペクタで取ったサンプルのうち、idle 以外の時間の合計を回数で割ったもの。
//   wrangler の 9230 番（プロキシ）は CDP の応答を返さないので、workerd 自身のインスペクタに繋ぐ（自動で探す。--inspector で指定も可）。
// - 応答は圧縮させない（accept-encoding: identity）。手元の workerd は gzip の圧縮を Worker の CPU 時間に含めるが、
//   本番ではエッジで圧縮されて CPU 時間に入らないため（2026-11 の計測: 課題一覧が手元 10.6ms → 7.9ms、本番は差なし）。
// - 手元は本番より速い（小さいリクエストで約 2 倍、重いページで約 1.3 倍）。無料プランの 10ms に余裕を持たせるなら手元で 5ms 以下が目安。
// - D1 の往復は wrangler dev の Local Explorer が記録するトレース（d1_* の span）を、route ごとに 1 回だけ実行して数える。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { derivePasswordKey } from '../src/lib/password-key.ts';

const { values: opts, positionals: routes } = parseArgs({
	allowPositionals: true,
	options: {
		base: { type: 'string', default: 'http://localhost:4174' },
		inspector: { type: 'string' },
		email: { type: 'string', default: 'demo@example.com' },
		password: { type: 'string', default: 'pm-demo-2026' },
		warmup: { type: 'string', default: '5' },
		runs: { type: 'string', default: '40' },
		self: { type: 'boolean', default: false },
		incl: { type: 'boolean', default: false },
		save: { type: 'string' }
	}
});
const base = opts.base;
const runs = Number(opts.runs);
const warmup = Number(opts.warmup);
const IDENTITY = { 'accept-encoding': 'identity' };

if (routes.length === 0) {
	console.error('usage: node scripts/cpu-profile.ts [options] <route...>');
	process.exit(1);
}

let passwordKey: string | undefined;
async function login(): Promise<string> {
	passwordKey ??= await derivePasswordKey(opts.email, opts.password);
	const res = await fetch(`${base}/login`, {
		method: 'POST',
		redirect: 'manual',
		headers: { origin: base, 'x-sveltekit-action': 'true', ...IDENTITY },
		// password は旧形式（scrypt）のハッシュのままのデータを読み込んだとき用（ログインで新形式に保存し直される）
		body: new URLSearchParams({ email: opts.email, password: opts.password, passwordKey })
	});
	await res.arrayBuffer();
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	if (!cookie) throw new Error(`login failed: HTTP ${res.status}`);
	return cookie;
}

/**
 * workerd のユーザー Worker のインスペクタを探す。--inspector-addr 付きで起動された workerd が開いているポートのうち、
 * /json に core:user が出るもの（wrangler のプロキシも同じ一覧を返すが、そちらの workerd には --inspector-addr が無い）
 */
async function findInspector(): Promise<string> {
	if (opts.inspector) return opts.inspector;
	const pids = execFileSync('pgrep', ['-f', 'workerd serve.*--inspector-addr'], {
		encoding: 'utf8'
	})
		.trim()
		.split('\n');
	for (const pid of pids) {
		let out: string;
		try {
			out = execFileSync('lsof', ['-nP', '-a', '-p', pid, '-iTCP', '-sTCP:LISTEN'], {
				encoding: 'utf8'
			});
		} catch {
			continue;
		}
		for (const m of out.matchAll(/:(\d+) \(LISTEN\)/g)) {
			const url = `http://127.0.0.1:${m[1]}`;
			try {
				const res = await fetch(`${url}/json`, { signal: AbortSignal.timeout(1000) });
				if ((await res.text()).includes('core:user')) return url;
			} catch {
				// インスペクタではないポート
			}
		}
	}
	throw new Error('workerd のインスペクタが見つかりません。pnpm perf:server を起動してください');
}

type CallFrame = { functionName: string; url: string; lineNumber: number };
type ProfileNode = { id: number; callFrame: CallFrame; children?: number[] };
type Profile = { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };

async function connect(inspector: string, timeoutMs: number) {
	const targets: { webSocketDebuggerUrl?: string }[] = await (
		await fetch(`${inspector}/json`)
	).json();
	// 一覧には D1・R2 などの内部の Worker も並ぶ。アプリの Worker は core:user:<name>（miniflare の内部のものを除く）
	const target = targets.find((t) =>
		/\/core:user:(?!miniflare-)/.test(t.webSocketDebuggerUrl ?? '')
	);
	if (!target?.webSocketDebuggerUrl) throw new Error('inspector target not found');
	// workerd は Origin の無い接続を受け付けない
	const ws = new WebSocket(target.webSocketDebuggerUrl, {
		headers: { origin: 'https://devtools.devprod.cloudflare.dev' }
	} as unknown as string[]);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let id = 0;
	const pending = new Map<number, (result: unknown) => void>();
	ws.onmessage = (m) => {
		const d = JSON.parse(String(m.data));
		pending.get(d.id)?.(d.result);
		pending.delete(d.id);
	};
	// wrangler dev が Worker を読み込み直している最中は応答が来ないことがあるので、待ち続けずに失敗させる
	const send = <T>(method: string, params: object = {}) =>
		new Promise<T>((resolve, reject) => {
			const timer = setTimeout(
				() =>
					reject(
						new Error(`${method}: インスペクタから応答がありません。もう一度実行してください`)
					),
				timeoutMs
			);
			pending.set(++id, (r) => {
				clearTimeout(timer);
				resolve(r as T);
			});
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { send, close: () => ws.close() };
}

function analyze(profile: Profile, n: number) {
	const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
	const parent = new Map<number, number>();
	for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
	const label = (cf: CallFrame) =>
		`${cf.functionName || '(anonymous)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
	const self = new Map<string, number>();
	const incl = new Map<string, number>();
	let busy = 0;
	for (let i = 0; i < profile.samples.length; i++) {
		const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
		const node = nodes.get(profile.samples[i])!;
		if (node.callFrame.functionName === '(idle)') continue;
		busy += ms;
		const k = label(node.callFrame);
		self.set(k, (self.get(k) ?? 0) + ms);
		const seen = new Set<string>();
		for (let id: number | undefined = node.id; id !== undefined; id = parent.get(id)) {
			const key = label(nodes.get(id)!.callFrame);
			if (seen.has(key)) continue;
			seen.add(key);
			incl.set(key, (incl.get(key) ?? 0) + ms);
		}
	}
	const top = (m: Map<string, number>) =>
		[...m]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 25)
			.map(([k, v]) => `  ${(v / n).toFixed(2).padStart(6)}ms  ${k}`)
			.join('\n');
	return { ms: busy / n, self: top(self), incl: top(incl) };
}

async function observability(path: 'clear' | 'query', body?: object) {
	const res = await fetch(`${base}/cdn-cgi/local/explorer/api/local/observability/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined
	});
	return res.json();
}

/** 1 回だけ実行して D1 の往復（d1_* の span）を数える */
async function countRoundTrips(request: () => Promise<number>): Promise<number> {
	await observability('clear');
	await request();
	await new Promise((r) => setTimeout(r, 300));
	const q = await observability('query', {
		sql: "SELECT count(*) FROM spans WHERE name LIKE 'd1_%'"
	});
	return Number(q.result.rows[0][0]);
}

const cookie = await login();
/**
 * wrangler dev の起動・読み込み直しの直後は、最初の接続に応答が来ないことがある。
 * 応答が来なければ繋ぎ直す（2 回目以降は応答する）
 */
async function connectProfiler() {
	for (let attempt = 1; ; attempt++) {
		const cdp = await connect(await findInspector(), 30_000);
		try {
			await Promise.race([
				cdp.send('Profiler.enable'),
				new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000))
			]);
			return cdp;
		} catch (e) {
			cdp.close();
			if (attempt === 3) throw e;
		}
	}
}

const cdp = await connectProfiler();
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });

const results: { route: string; ms: number; trips: number; status: number }[] = [];
for (const route of routes) {
	const [method, path] = route.includes(' ') ? route.split(' ') : ['GET', route];
	let status = 0;
	const request = async () => {
		if (route === 'LOGIN') {
			await login();
			return (status = 303);
		}
		const res = await fetch(base + path, {
			method,
			redirect: 'manual',
			headers: { cookie, origin: base, ...IDENTITY }
		});
		await res.arrayBuffer();
		return (status = res.status);
	};
	for (let i = 0; i < warmup; i++) await request();
	await cdp.send('Profiler.start');
	for (let i = 0; i < runs; i++) await request();
	const { profile } = await cdp.send<{ profile: Profile }>('Profiler.stop');
	if (opts.save)
		writeFileSync(`${opts.save}-${results.length}.cpuprofile`, JSON.stringify(profile));
	const a = analyze(profile, runs);
	if (opts.self) console.log(`\n=== ${route} self\n${a.self}`);
	if (opts.incl) console.log(`\n=== ${route} inclusive\n${a.incl}`);
	const trips = await countRoundTrips(request);
	results.push({ route, ms: a.ms, trips, status });
}
cdp.close();

console.log('\n   CPU  D1 往復  status  route');
for (const r of results) {
	console.log(
		`${r.ms.toFixed(2).padStart(6)}ms  ${String(r.trips).padStart(6)}  ${String(r.status).padStart(6)}  ${r.route}`
	);
}
