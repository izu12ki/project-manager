#!/usr/bin/env bash
# Workers の無料プラン（1 リクエストの CPU 時間 10ms）で動くかを確かめる。
# CPU 時間の上限を 10ms にした検証用の Worker（<name>-free-check）と、
# 専用の D1・R2 を作り、E2E のシナリオをその Worker に向けて流しながら wrangler tail で CPU 時間を記録する。
#
#   CLOUDFLARE_ACCOUNT_ID=... bash scripts/free-plan-check.sh            # 作り直して E2E を流し、終わったら Worker を消す
#   CLOUDFLARE_ACCOUNT_ID=... bash scripts/free-plan-check.sh --keep     # Worker を残す（続けて手で試すとき）
#   CLOUDFLARE_ACCOUNT_ID=... bash scripts/free-plan-check.sh --delete   # 検証用の Worker・D1・R2 を消す
#
# E2E のアカウントのパスワードはリポジトリにあるので、Worker を残したままにしないこと（誰でも管理者でログインできる）
#
# 本番の Worker・D1・R2（wrangler.jsonc の名前）には触れない。検証用の名前は必ず -free-check で終わる。
# 結果は .wrangler/free-check/ に残る（tail.json と、route ごとの集計の summary.txt）。
# Paid のアカウントでは CPU の上限（limits.cpu_ms）を 10ms にして出す。無料プランのアカウントでは上限を設定できないので、
# 付けずに出す（無料プランの 10ms がそのまま効く）。どちらも「たまに超える分は許される」のは本番と同じ
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID を指定してください}"
export WRANGLER_SEND_METRICS=false

NAME=project-manager-free-check
DB_NAME=project-manager-free-check
BUCKET=project-manager-free-check-attachments
OUT=.wrangler/free-check
for n in "$NAME" "$DB_NAME" "$BUCKET"; do
	[[ "$n" == *-free-check* ]] || { echo "検証用の名前ではありません: $n" >&2; exit 1; }
done

if [ "${1:-}" = "--delete" ]; then
	pnpm exec wrangler delete --name "$NAME" --force || true
	pnpm exec wrangler d1 delete "$DB_NAME" -y || true
	pnpm exec wrangler r2 bucket delete "$BUCKET" || true
	exit 0
fi

mkdir -p "$OUT"
pnpm db:sync >/dev/null
pnpm exec vite build >"$OUT/build.log"

# adapter-cloudflare が生成した設定を写し、名前・D1・R2・CPU の上限・メールの送り方を検証用に変える
CONFIG=.svelte-kit/cloudflare/worker/free-check.json
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(".svelte-kit/cloudflare/worker/wrangler.json", "utf8"));
for (const k of ["configPath", "userConfigPath", "topLevelName"]) delete c[k];
c.name = process.argv[1];
c.d1_databases = c.d1_databases.map((d) => ({ ...d, database_name: process.argv[2] }));
c.r2_buckets = c.r2_buckets.map((b) => ({ ...b, bucket_name: process.argv[3] }));
c.limits = { cpu_ms: 10 };
c.vars = { ...c.vars, MAIL_PROVIDER: "console" };
c.preview_urls = false;
fs.writeFileSync(process.argv[4], JSON.stringify(c, null, "\t"));
' "$NAME" "$DB_NAME" "$BUCKET" "$CONFIG"

# D1 は毎回空にする（E2E は空の DB の初期セットアップから始まる）。消して作り直すと、直後の deploy が消した DB の ID を
# 引いて失敗することがあるので、DB と表は残して行を消す（外部キーの検査はまとめて最後に行われるので、順番は問わない）
pnpm exec wrangler d1 create "$DB_NAME" --location apac >/dev/null 2>&1 || true
# 名前だけだと、前に出した版の結び付き（消した DB の ID）が使われることがあるので、ID も書く
DB_ID=$(pnpm exec wrangler d1 list --json |
	node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).find((d) => d.name === process.argv[1]).uuid))' "$DB_NAME")
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
c.d1_databases = c.d1_databases.map((d) => ({ ...d, database_id: process.argv[2] }));
fs.writeFileSync(process.argv[1], JSON.stringify(c, null, "\t"));
' "$CONFIG" "$DB_ID"
pnpm exec wrangler d1 migrations apply DB --remote --config "$CONFIG" >/dev/null
TABLES=$(pnpm exec wrangler d1 execute DB --remote --config "$CONFIG" --json --command \
	"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'" |
	node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s)[0].results.map((r) => r.name).join(" ")))')
SQL="PRAGMA defer_foreign_keys = on;"
for t in $TABLES; do SQL="$SQL DELETE FROM \"$t\";"; done
pnpm exec wrangler d1 execute DB --remote --config "$CONFIG" --command "$SQL" >/dev/null
pnpm exec wrangler r2 bucket create "$BUCKET" >/dev/null 2>&1 || true

# 無料プランのアカウントでは CPU の上限を設定できない（code 100328）。その場合は上限を外して出す（無料プランの 10ms がそのまま効く）
if ! pnpm exec wrangler deploy --config "$CONFIG" >"$OUT/deploy.log" 2>&1; then
	grep -q '100328' "$OUT/deploy.log" || { cat "$OUT/deploy.log" >&2; exit 1; }
	echo '無料プランのアカウントなので、CPU の上限を付けずに出します（無料プランの 10ms がそのまま効きます）'
	node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete c.limits;
fs.writeFileSync(process.argv[1], JSON.stringify(c, null, "\t"));
' "$CONFIG"
	pnpm exec wrangler deploy --config "$CONFIG" >"$OUT/deploy.log" 2>&1 || { cat "$OUT/deploy.log" >&2; exit 1; }
fi
URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$OUT/deploy.log" | head -1)
[ -n "$URL" ] || { echo "workers.dev の URL が分かりません" >&2; exit 1; }
SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
printf '{"BETTER_AUTH_SECRET":"%s","BETTER_AUTH_URL":"%s"}' "$SECRET" "$URL" |
	pnpm exec wrangler secret bulk --config "$CONFIG" >/dev/null
# シークレットの反映を待つ
for _ in $(seq 1 30); do
	curl -s -o /dev/null -w '%{http_code}' "$URL/setup" | grep -q 200 && break
	sleep 2
done

pnpm exec wrangler tail "$NAME" --format json >"$OUT/tail.json" 2>"$OUT/tail.err" &
TAIL=$!
trap 'kill $TAIL 2>/dev/null || true' EXIT
sleep 5

STATUS=0
E2E_BASE_URL="$URL" E2E_D1_ARGS="--remote --config $CONFIG" pnpm exec playwright test || STATUS=$?

sleep 10
kill $TAIL 2>/dev/null || true
if [ "${1:-}" != "--keep" ]; then
	pnpm exec wrangler delete --name "$NAME" --force >/dev/null || echo "Worker を消せませんでした。--delete で消してください" >&2
fi
node scripts/tail-cpu.ts "$OUT/tail.json" | tee "$OUT/summary.txt"
echo "E2E: $([ $STATUS = 0 ] && echo 成功 || echo "失敗（${STATUS}）")。Worker: $URL"
exit $STATUS
