import * as v from 'valibot';
import { command } from '$app/server';
import { remoteContext, runCommand } from '#lib/server/remote-helpers.ts';
import { importUsers, planUserImport } from '#lib/server/services/user-import.ts';

// 行の中身はサービスで検査する。
// 確認画面の計画も command にするのは、query だと引数が URL に載り、1,000 行が入らないため
const Rows = v.object({ rows: v.array(v.unknown()) });

export const previewUserImport = command(Rows, ({ rows }) =>
	runCommand(() => planUserImport(remoteContext(), { rows }))
);

export const runUserImport = command(Rows, ({ rows }) =>
	runCommand(() => importUsers(remoteContext(), { rows }))
);
