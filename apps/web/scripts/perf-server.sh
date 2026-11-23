#!/usr/bin/env bash
# CPU 時間の計測用: ビルドして wrangler dev（本番に近い実行環境）を http://localhost:4174 で動かす。
# 計測は別のシェルで node scripts/cpu-profile.ts を実行する（使い方はそのファイルの先頭）。
#
#   pnpm perf:server              # 前回の DB（.wrangler/perf-state）をそのまま使う
#   pnpm perf:server data.sql     # DB を作り直し、マイグレーションの後に data.sql を流す
#
# 開発用の .dev.vars とローカル D1 には影響しない（E2E と同じく --env-file と --persist-to で分ける）
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.perf.vars
STATE=.wrangler/perf-state
SEED="${1:-}"

cat >"$ENV_FILE" <<VARS
BETTER_AUTH_SECRET=perf-secret-perf-secret-perf-secret-0123
BETTER_AUTH_URL=http://localhost:4174
MAIL_PROVIDER=console
VARS
trap 'rm -f "$ENV_FILE"' EXIT

if [ -n "$SEED" ]; then
	SEED="$(cd "$(dirname "$SEED")" && pwd)/$(basename "$SEED")"
	rm -rf "$STATE"
fi
pnpm db:sync
pnpm exec wrangler d1 migrations apply DB --local --persist-to "$STATE" >&2
if [ -n "$SEED" ]; then
	pnpm exec wrangler d1 execute DB --local --persist-to "$STATE" --file "$SEED" >&2
fi

pnpm exec vite build
WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port 4174 --env-file "$ENV_FILE" --persist-to "$STATE"
