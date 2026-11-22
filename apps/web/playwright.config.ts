import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	// main-flow は 1 本の長いシナリオ。手元では 1 分弱だが、CI では 80〜125 秒かかる（2026-11 の計測。
	// 125 秒の回で 120 秒の上限を超えた）。止まったときに気づくための上限なので、余裕を持たせる
	timeout: 240_000,
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'bash scripts/e2e-server.sh',
		url: 'http://localhost:4173/login',
		timeout: 240_000,
		reuseExistingServer: false,
		env: { WRANGLER_SEND_METRICS: 'false' }
	}
});
