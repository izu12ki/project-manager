// 同じリクエストの中で同時に出た読み取りの batch を、D1 への 1 往復にまとめる。
// SvelteKit はレイアウトとページの load を並行に、remote query は描画中にまとめて実行するので、
// それぞれが 1 回ずつ db.batch を送ると往復の回数だけ CPU 時間がかかる（手元で 1 往復 0.25〜0.4ms）。
// 次の setTimeout(0) までに来た呼び出しを 1 回の db.batch に入れ、結果を呼び出しごとに切り分けて返す。
//
// 同じ文（cachedRead で組み立てと値が同じもの）は 1 回だけ送り、結果を呼び出し同士で共有する。レイアウトと
// ページがそれぞれ引くもの（見られるプロジェクトの一覧、プロジェクトへのアクセス、ステータスなど）が重なるため。
// 同じ batch の中なら同じトランザクションで読むので、2 回送っても結果は変わらない。shareAcrossBatches では
// 後の batch にも前の結果を使う（閲覧のリクエスト用。間に書き込むと古い結果を返すので、書き込むリクエストでは使わない）。
// 共有した結果（配列と行のオブジェクト）は呼び出し側で書き換えないこと
//
// 読み取り専用。db.batch は 1 つのトランザクションとして実行され、1 文が失敗すると同じまとまりの呼び出しはすべて失敗する。
// 書き込みを混ぜると、無関係な読み取りの失敗で書き込みが取り消されるので、書き込みは ctx.db.batch で送ること
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch';
import type { DB } from '.';
import { readKeyOf } from './cached-read';

/**
 * 読み取りの文（select と db.query）。insert・update・delete の文は `_.table`（書き込む先）を持つので、型で受け付けない。
 * `.returning()` の付いた書き込みも同じ
 */
type ReadItem = BatchItem<'sqlite'> & { readonly _: { readonly table?: never } };

/** db.batch と同じ形で、読み取りの文だけを受け付ける */
export type ReadBatch = <U extends ReadItem, T extends Readonly<[U, ...U[]]>>(
	batch: T
) => Promise<BatchResponse<T>>;

type Pending = {
	item: BatchItem<'sqlite'>;
	resolve: (result: unknown) => void;
	reject: (e: unknown) => void;
};

export function createReadBatcher(
	db: DB,
	{ shareAcrossBatches = false }: { shareAcrossBatches?: boolean } = {}
): ReadBatch {
	let queue: Pending[] = [];
	/** 送った（送る）文の結果。readKeyOf の文字列ごと */
	let shared = new Map<string, Promise<unknown>>();

	async function flush() {
		const calls = queue;
		queue = [];
		if (!shareAcrossBatches) shared = new Map();
		const items = calls.map((c) => c.item) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
		try {
			const results: unknown[] = await db.batch(items);
			calls.forEach((c, i) => c.resolve(results[i]));
		} catch (e) {
			for (const c of calls) c.reject(e);
		}
	}

	function readOne(item: BatchItem<'sqlite'>): Promise<unknown> {
		const key = readKeyOf(item);
		const hit = key === undefined ? undefined : shared.get(key);
		if (hit) return hit;
		const result = new Promise<unknown>((resolve, reject) => {
			if (queue.length === 0) setTimeout(flush, 0);
			queue.push({ item, resolve, reject });
		});
		if (key !== undefined) {
			const map = shared;
			map.set(key, result);
			// 失敗した結果は使い回さない（次に引くときは送り直す）
			result.catch(() => {
				if (map.get(key) === result) map.delete(key);
			});
		}
		return result;
	}

	const read = (items: readonly BatchItem<'sqlite'>[]) => Promise.all(items.map(readOne));
	return read as unknown as ReadBatch;
}
