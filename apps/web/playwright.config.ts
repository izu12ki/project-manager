import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	// main-flow は 1 本の長いシナリオ。CI では 45〜60 秒かかる（遅いランナーで 60 秒を超えた）ので余裕を持たせる
	timeout: 120_000,
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'bash scripts/e2e-server.sh',
		url: 'http://localhost:4173/login',
		timeout: 240_000,
		reuseExistingServer: false,
		env: { WRANGLER_SEND_METRICS: 'false' }
	}
});
