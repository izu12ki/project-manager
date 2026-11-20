import * as v from 'valibot';
import { command } from '$app/server';
import { remoteContext, runCommand } from '#lib/server/remote-helpers.ts';
import { importIssues, planIssueImport } from '#lib/server/services/issue-import.ts';

// 行の中身はサービスで検査する。
// 確認画面の計画も command にするのは、query だと引数が URL に載り、500 件の課題が入らないため
export const previewIssueImport = command(
	v.object({ key: v.string(), rows: v.array(v.unknown()) }),
	({ key, rows }) => runCommand(() => planIssueImport(remoteContext(), key, { rows }))
);

export const runIssueImport = command(
	v.object({ key: v.string(), rows: v.array(v.unknown()), people: v.array(v.unknown()) }),
	({ key, rows, people }) => runCommand(() => importIssues(remoteContext(), key, { rows, people }))
);
