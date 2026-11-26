// 形の決まった読み取りの文を、isolate ごとに 1 回だけ組み立てて使い回す。
// Drizzle は文を送るたびに、組み立てた式から SQL の文字列と、結果の行をオブジェクトに直す関数（mapper）を作る。
// Workers（workerd）ではこれが 1 画面で 0.6〜2ms ほどかかり（手元の計測）、Free プランの 10ms に対して小さくない。
// 値をプレースホルダー（sql.placeholder）にした文を最初の 1 回だけ組み立て、以後は値だけを埋めて送る。
//
// db.batch（ctx.readBatch）に入れる用。db.batch は各要素の _prepare() を呼び、その結果の getQuery()・stmt・
// executeMethod・mapper・mode だけを使う（drizzle-orm/d1 の session.js）。ここではその形を返す。Drizzle の内部の形に
// 依存するので、Drizzle を上げたら cached-read.test.ts と各画面の batch のテスト（libsql の db.batch）、
// E2E（D1 の db.batch。stmt を使うのはこちらだけ）で確かめる
import { fillPlaceholders, sql, type Placeholder } from 'drizzle-orm';
import type { DB } from '.';

/** db.batch が _prepare() の結果から使うもの */
interface BatchPrepared {
	getQuery(): { sql: string; params: unknown[] };
	stmt: D1PreparedStatement;
	executeMethod: unknown;
	mapper: unknown;
	mode: unknown;
}

/** これまでに作った cachedRead の、文を組み立てる関数 */
const templates: ((db: DB) => unknown)[] = [];

/** cachedRead が返す文に付ける、同じ文かどうかの印（組み立ての番号と値） */
const READ_KEY = Symbol('readKey');

/**
 * cachedRead が返した文なら、組み立てと値で決まる文字列を返す。同じ文字列の文は同じ SQL と値を送る。
 * ctx.readBatch が同じ文を 1 回だけ送るのに使う（db/read-batch.ts）。それ以外の文は undefined
 */
export function readKeyOf(item: unknown): string | undefined {
	return (item as { [READ_KEY]?: string })[READ_KEY];
}

/**
 * これまでに作った cachedRead の文をまとめて組み立てる。Worker の起動時（リクエストの外）に呼び、
 * isolate の最初のリクエストで組み立てる分（と Drizzle のコードを初めて動かす分）の CPU 時間を起動時に移す。
 * D1 には何も送らない（文の準備だけ）
 */
export function buildCachedReads(db: DB): void {
	for (const ensure of templates) ensure(db);
}

/**
 * build（読み取りの select）を一度だけ組み立て、呼ぶたびに values を埋めた文を返す。
 * build は names の名前のプレースホルダーを受け取り、リクエストごとに変わる値の代わりに式へ入れる。
 * それ以外の値（ログイン中の人など）を build に含めないこと。最初のリクエストの値で固定されてしまう。
 * 返す文は db.batch / ctx.readBatch の要素にだけ使える（await や .all() は使えない）
 */
export function cachedRead<K extends string, Q>(
	names: readonly K[],
	build: (db: DB, p: Record<K, Placeholder<K>>) => Q
): (db: DB, values: Record<K, string | number>) => Q {
	const placeholders = Object.fromEntries(names.map((n) => [n, sql.placeholder(n)])) as Record<
		K,
		Placeholder<K>
	>;
	let template: { sql: string; params: unknown[]; prepared: BatchPrepared } | undefined;
	const ensure = (db: DB) => {
		if (!template) {
			const query = build(db, placeholders) as unknown as { _prepare(): BatchPrepared };
			const prepared = query._prepare();
			const { sql: text, params } = prepared.getQuery();
			template = { sql: text, params, prepared };
		}
		return template;
	};
	const id = templates.push(ensure);
	return (db, values) => {
		const item = {
			[READ_KEY]: `${id} ${JSON.stringify(names.map((n) => values[n]))}`,
			_prepare(): BatchPrepared {
				const { sql: text, params, prepared } = ensure(db);
				const filled = fillPlaceholders(params, values);
				return {
					getQuery: () => ({ sql: text, params: filled }),
					// 文はリクエストの D1 で作る（最初のリクエストの D1 の文を使い回さない）。
					// テストの libsql の db.batch は stmt を読まないので、読まれたときに作る
					get stmt() {
						return db.$client.prepare(text);
					},
					executeMethod: prepared.executeMethod,
					mapper: prepared.mapper,
					mode: prepared.mode
				};
			}
		};
		return item as unknown as Q;
	};
}
