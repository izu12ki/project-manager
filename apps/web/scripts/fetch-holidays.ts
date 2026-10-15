// 内閣府「国民の祝日」CSV を取得し、UTF-8・LF に変換して保存する（holidays.test.ts の正解データ）。
// 内閣府は毎年 2 月ごろ翌年分を追記する。そのときに `pnpm holidays:fetch` を実行してコミットする。
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const OUT = new URL('../src/lib/testdata/syukujitsu.csv', import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
const text = new TextDecoder('shift_jis').decode(await res.arrayBuffer());
writeFileSync(OUT, text.replace(/\r\n?/g, '\n').trimEnd() + '\n');
console.log(`saved ${OUT.pathname}`);
