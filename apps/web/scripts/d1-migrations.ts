// drizzle/ のマイグレーションを .d1-migrations/<名前>.sql に書き出す（wrangler d1 migrations apply が読む）。
// 出力は生成物なので gitignore している。pnpm db:migrate:local / db:migrate:remote が先に実行する。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listMigrations } from '../src/lib/server/db/d1-migrations.ts';

const SOURCE = fileURLToPath(new URL('../drizzle', import.meta.url));
const OUT = fileURLToPath(new URL('../.d1-migrations', import.meta.url));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const migrations = listMigrations(SOURCE);
for (const m of migrations) writeFileSync(`${OUT}/${m.name}.sql`, m.sql);
console.log(`wrote ${migrations.length} migrations to .d1-migrations/`);
