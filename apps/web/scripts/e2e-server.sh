#!/usr/bin/env bash
# E2E 用: 空の libSQL を起動 → マイグレーション → ビルド → wrangler dev（本番に近い実行環境）
# 開発者の .dev.vars に影響されないよう、--env-file で E2E 専用の値を渡す（--env-file 指定時 wrangler は .dev.vars を読まない）
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL=http://127.0.0.1:8081
ENV_FILE=.e2e.vars
rm -f e2e.db e2e.db-*
cat >"$ENV_FILE" <<VARS
TURSO_DATABASE_URL=$DB_URL
BETTER_AUTH_SECRET=e2e-secret-e2e-secret-e2e-secret-0123
BETTER_AUTH_URL=http://localhost:4173
MAIL_PROVIDER=console
VARS

turso dev --db-file e2e.db --port 8081 &
TURSO_PID=$!
trap 'kill $TURSO_PID 2>/dev/null || true; rm -f "$ENV_FILE"' EXIT

for i in $(seq 1 40); do
	if ! kill -0 "$TURSO_PID" 2>/dev/null; then
		echo "turso dev exited unexpectedly (port 8081 in use? sqld missing?)" >&2
		exit 1
	fi
	if [ "$i" = 40 ]; then
		TURSO_DATABASE_URL=$DB_URL pnpm exec drizzle-kit migrate >&2 || {
			echo "migration failed" >&2
			exit 1
		}
		break
	fi
	if TURSO_DATABASE_URL=$DB_URL pnpm exec drizzle-kit migrate >/dev/null 2>&1; then break; fi
	sleep 0.5
done

# pnpm build の wrangler types は型の生成だけでビルド結果は変わらないので省く（CI で 1 分以上止まることがあった）
pnpm exec vite build
pnpm exec wrangler dev --port 4173 --env-file "$ENV_FILE" &
WRANGLER_PID=$!
trap 'kill $WRANGLER_PID $TURSO_PID 2>/dev/null || true; rm -f "$ENV_FILE"' EXIT
wait $WRANGLER_PID
