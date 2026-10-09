import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	timeout: 60_000,
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'bash scripts/e2e-server.sh',
		url: 'http://localhost:4173/login',
		timeout: 240_000,
		reuseExistingServer: false,
		env: { WRANGLER_SEND_METRICS: 'false' }
	}
});
