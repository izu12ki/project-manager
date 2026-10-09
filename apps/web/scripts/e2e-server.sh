#!/usr/bin/env bash
# E2E 用: 空の libSQL を起動 → マイグレーション → ビルド → wrangler dev（本番に近い実行環境）
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL=http://127.0.0.1:8081
rm -f e2e.db e2e.db-*
turso dev --db-file e2e.db --port 8081 &
TURSO_PID=$!
trap 'kill $TURSO_PID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
	if TURSO_DATABASE_URL=$DB_URL pnpm exec drizzle-kit migrate >/dev/null 2>&1; then break; fi
	if [ "$i" = 40 ]; then echo "migration failed" >&2; exit 1; fi
	sleep 0.5
done

pnpm build
pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port 4173 \
	--var TURSO_DATABASE_URL:$DB_URL \
	--var BETTER_AUTH_SECRET:e2e-secret-e2e-secret-e2e-secret-0123 \
	--var BETTER_AUTH_URL:http://localhost:4173 \
	--var MAIL_PROVIDER:console &
WRANGLER_PID=$!
trap 'kill $WRANGLER_PID $TURSO_PID 2>/dev/null || true' EXIT
wait $WRANGLER_PID
