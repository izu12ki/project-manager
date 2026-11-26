#!/usr/bin/env bash
# E2E 用: 空のローカル D1 にマイグレーション → ビルド → wrangler dev（本番に近い実行環境）
# 開発者の .dev.vars とローカル D1 に影響されないよう、--env-file で E2E 専用の値を渡し（--env-file 指定時 wrangler は .dev.vars を読まない）、
# D1 などの状態は専用のディレクトリ（--persist-to）に置く
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.e2e.vars
STATE=.wrangler/e2e-state
rm -rf "$STATE"
cat >"$ENV_FILE" <<VARS
BETTER_AUTH_SECRET=e2e-secret-e2e-secret-e2e-secret-0123
BETTER_AUTH_URL=http://localhost:4173
MAIL_PROVIDER=console
VARS
trap 'rm -f "$ENV_FILE"' EXIT

# マイグレーションの適用（CI で wrangler の起動を含めて約 10 秒）とビルドは互いに使わないので、並行して進める
{ pnpm db:sync && pnpm exec wrangler d1 migrations apply DB --local --persist-to "$STATE" >&2; } &
MIGRATE_PID=$!
trap 'kill $MIGRATE_PID 2>/dev/null || true; rm -f "$ENV_FILE"' EXIT

# pnpm build の wrangler types は型の生成だけでビルド結果は変わらないので省く（CI で 1 分以上止まることがあった）
pnpm exec vite build
# 失敗していれば set -e でここで止まる
wait $MIGRATE_PID
pnpm exec wrangler dev --port 4173 --env-file "$ENV_FILE" --persist-to "$STATE" &
WRANGLER_PID=$!
trap 'kill $WRANGLER_PID 2>/dev/null || true; rm -f "$ENV_FILE"' EXIT
wait $WRANGLER_PID
