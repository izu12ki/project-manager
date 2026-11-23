// 同じリクエストの中で同時に出た読み取りの batch を、D1 への 1 往復にまとめる。
// SvelteKit はレイアウトとページの load を並行に、remote query は描画中にまとめて実行するので、
// それぞれが 1 回ずつ db.batch を送ると往復の回数だけ CPU 時間がかかる（手元で 1 往復 0.25〜0.4ms）。
// 次の setTimeout(0) までに来た呼び出しを 1 回の db.batch に入れ、結果を呼び出しごとに切り分けて返す。
//
// 読み取り専用。db.batch は 1 つのトランザクションとして実行され、1 文が失敗すると同じまとまりの呼び出しはすべて失敗する。
// 書き込みを混ぜると、無関係な読み取りの失敗で書き込みが取り消されるので、書き込みは ctx.db.batch で送ること
import type { BatchItem } from 'drizzle-orm/batch';
import type { DB } from '.';

export type ReadBatch = DB['batch'];

type Pending = {
	items: BatchItem<'sqlite'>[];
	resolve: (results: unknown[]) => void;
	reject: (e: unknown) => void;
};

export function createReadBatcher(db: DB): ReadBatch {
	let queue: Pending[] = [];

	async function flush() {
		const calls = queue;
		queue = [];
		const items = calls.flatMap((c) => c.items) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
		try {
			const results: unknown[] = await db.batch(items);
			let i = 0;
			for (const c of calls) c.resolve(results.slice(i, (i += c.items.length)));
		} catch (e) {
			for (const c of calls) c.reject(e);
		}
	}

	const read = (items: readonly BatchItem<'sqlite'>[]) =>
		new Promise<unknown[]>((resolve, reject) => {
			if (queue.length === 0) setTimeout(flush, 0);
			queue.push({ items: [...items], resolve, reject });
		});
	return read as unknown as ReadBatch;
}
