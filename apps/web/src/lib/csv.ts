// CSV の読み込み。ブラウザとサーバーの両方で使う（$lib/server を import しない）。

// UTF-8（BOM あり・なし）を先に試し、不正なら Shift_JIS（CP932 互換）で読む
export function decodeCsv(bytes: Uint8Array): string {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return new TextDecoder('utf-8').decode(bytes.subarray(3));
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('shift_jis').decode(bytes);
	}
}

// 空行は捨てる。閉じていない引用符は最後までを 1 セルにする
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const endRow = () => {
		row.push(cell);
		cell = '';
		if (row.length > 1 || row[0] !== '') rows.push(row);
		row = [];
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c !== '"') cell += c;
			else if (text[i + 1] === '"') {
				cell += '"';
				i++;
			} else quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(cell);
			cell = '';
		} else if (c === '\n') endRow();
		else if (c === '\r') {
			if (text[i + 1] === '\n') i++;
			endRow();
		} else cell += c;
	}
	if (cell !== '' || row.length > 0) endRow();
	return rows;
}

// ヘッダーは前後の空白を除いて比べる。1 つでもなければ null
export function columnIndex<N extends string>(
	header: string[],
	names: readonly N[]
): Record<N, number> | null {
	const trimmed = header.map((h) => h.trim());
	const result = {} as Record<N, number>;
	for (const name of names) {
		const index = trimmed.indexOf(name);
		if (index < 0) return null;
		result[name] = index;
	}
	return result;
}

// Backlog の CSV はセル内の改行を 2 文字の「\n」で書くので、改行に戻す
export function restoreNewlines(cell: string): string {
	return cell.replaceAll('\\n', '\n');
}
