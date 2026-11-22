// D1 の制約に合わせるための部品。
// D1 は 1 クエリのバインド変数が 100 個まで（Turso / SQLite の既定より大幅に少ない）。
import { getTableColumns, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

export const D1_MAX_PARAMS = 100;

/**
 * column IN (...)。配列は 1 個の JSON 文字列として渡すので、要素がいくつでも変数は 1 個で済む。
 * 空配列は常に偽。サブクエリはそのまま IN に使う。
 */
export function inList(
	column: SQLiteColumn | SQL,
	values: readonly (string | number)[] | SQLWrapper
): SQL {
	if (!isList(values)) return sql`${column} in ${values}`;
	if (values.length === 0) return sql`0`;
	return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}

function isList(v: readonly (string | number)[] | SQLWrapper): v is readonly (string | number)[] {
	return Array.isArray(v);
}

/** 複数行の insert を、1 文の変数が D1_MAX_PARAMS 以下になる行数ずつに分ける */
export function insertChunks<T>(table: SQLiteTable, rows: readonly T[]): T[][] {
	const size = Math.max(1, Math.floor(D1_MAX_PARAMS / Object.keys(getTableColumns(table)).length));
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
	return chunks;
}
