import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	// マイグレーションの生成だけに使う。適用は wrangler d1 migrations apply（pnpm db:migrate:local / db:migrate:remote）
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle'
});
