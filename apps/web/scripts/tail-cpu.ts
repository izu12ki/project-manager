// `wrangler tail --format json` の出力から、route ごとの CPU 時間（p50・p90・最大）と、ok 以外の結果（exceededCpu など）を数える。
//
//   pnpm exec wrangler tail <worker> --format json > tail.json   # 別のシェルで操作してから Ctrl+C
//   node scripts/tail-cpu.ts tail.json
//
// ID・番号・トークンを含むパスは :id にまとめる（/projects/ACME/issues/12 → /projects/:key/issues/:n など）
import { readFileSync } from 'node:fs';

type TailItem = {
	cpuTime?: number;
	outcome?: string;
	event?: { request?: { url: string; method: string } };
};

/** wrangler tail は JSON を改行区切りではなく整形して並べるので、括弧の対応で 1 件ずつ切り出す */
function parseConcatenatedJson(text: string): TailItem[] {
	const items: TailItem[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') inString = true;
		else if (c === '{' && depth++ === 0) start = i;
		else if (c === '}' && --depth === 0) items.push(JSON.parse(text.slice(start, i + 1)));
	}
	return items;
}

function routeOf(method: string, url: string): string {
	const u = new URL(url);
	const path = u.pathname
		.replace(/^\/projects\/[^/]+/, '/projects/:key')
		.replace(/\/issues\/\d+/, '/issues/:n')
		.replace(/\/(attachments|emoji|project-icons|invite)\/[^/]+/, '/$1/:id')
		.replace(/^\/api\/v1\/projects\/[^/]+/, '/api/v1/projects/:key')
		.replace(/\/api\/auth\/reset-password\/[^/]+/, '/api/auth/reset-password/:token');
	return `${method} ${path}`;
}

const items = parseConcatenatedJson(readFileSync(process.argv[2], 'utf8'));
const byRoute = new Map<string, number[]>();
const notOk: string[] = [];
for (const it of items) {
	const req = it.event?.request;
	if (!req || it.cpuTime === undefined) continue;
	const route = routeOf(req.method, req.url);
	byRoute.set(route, [...(byRoute.get(route) ?? []), it.cpuTime]);
	if (it.outcome !== 'ok') notOk.push(`${it.outcome} ${route} (${it.cpuTime}ms)`);
}
const pick = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
console.log('   件数    p50    p90    最大  route');
for (const [route, xs] of [...byRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
	xs.sort((a, b) => a - b);
	const cols = [pick(xs, 0.5), pick(xs, 0.9), xs.at(-1)!].map((v) => `${v}ms`.padStart(6));
	console.log(`${String(xs.length).padStart(6)} ${cols.join(' ')}  ${route}`);
}
const all = [...byRoute.values()].flat().sort((a, b) => a - b);
console.log(
	`\n全 ${all.length} 件: p50 ${pick(all, 0.5)}ms、p90 ${pick(all, 0.9)}ms、10ms を超えたもの ${all.filter((x) => x > 10).length} 件`
);
console.log(notOk.length === 0 ? 'ok 以外の結果: なし' : `ok 以外の結果:\n  ${notOk.join('\n  ')}`);
