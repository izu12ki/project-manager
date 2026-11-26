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
	return (db, values) => {
		const item = {
			_prepare(): BatchPrepared {
				if (!template) {
					const query = build(db, placeholders) as unknown as { _prepare(): BatchPrepared };
					const prepared = query._prepare();
					const { sql: text, params } = prepared.getQuery();
					template = { sql: text, params, prepared };
				}
				const { sql: text, params, prepared } = template;
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
