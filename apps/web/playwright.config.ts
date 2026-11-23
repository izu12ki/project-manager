import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	// main-flow は 1 本の長いシナリオ。手元では 1 分弱だが、CI では 80〜125 秒かかる（2026-11 の計測。
	// 125 秒の回で 120 秒の上限を超えた）。止まったときに気づくための上限なので、余裕を持たせる
	// 遠い環境（E2E_BASE_URL）では 1 回の往復が長く、全体で 4 分を超え、画面の更新も 5 秒を超えることがある
	timeout: process.env.E2E_BASE_URL ? 600_000 : 240_000,
	expect: { timeout: process.env.E2E_BASE_URL ? 20_000 : 5_000 },
	use: { baseURL, trace: 'retain-on-failure' },
	// E2E_BASE_URL を指定したときは、その環境（scripts/free-plan-check.sh の検証用 Worker）に向けて流し、手元のサーバーは起動しない
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: 'bash scripts/e2e-server.sh',
				url: 'http://localhost:4173/login',
				timeout: 240_000,
				reuseExistingServer: false,
				env: { WRANGLER_SEND_METRICS: 'false' }
			}
});
