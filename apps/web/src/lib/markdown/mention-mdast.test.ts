import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Paragraph, Root } from 'mdast';
import { mentionFromMarkdown, mentionToMarkdown } from './mention-mdast';

const id = '0192f0c1-0000-7000-8000-000000000001';
const parse = (md: string) => fromMarkdown(md, { mdastExtensions: [mentionFromMarkdown()] });
const stringify = (tree: Root) => toMarkdown(tree, { extensions: [mentionToMarkdown()] });

describe('mention mdast', () => {
	it('@[名前](user:uuid) を mention ノードにする', () => {
		const p = parse(`hi @[田中 太郎](user:${id}) さん`).children[0] as Paragraph;
		expect(p.children).toEqual([
			expect.objectContaining({ type: 'text', value: 'hi ' }),
			expect.objectContaining({ type: 'mention', name: '田中 太郎', userId: id }),
			expect.objectContaining({ type: 'text', value: ' さん' })
		]);
	});
	it('コード内は置き換えない', () => {
		expect(JSON.stringify(parse('`@[a](user:' + id + ')`'))).not.toContain('"mention"');
	});
	it('uuid が不正なら置き換えない', () => {
		expect(JSON.stringify(parse('@[a](user:xyz)'))).not.toContain('"mention"');
	});
	it('@ が直前にないリンクは置き換えない', () => {
		expect(JSON.stringify(parse(`[a](user:${id})`))).not.toContain('"mention"');
	});
	it('元の記法に書き戻す', () => {
		expect(stringify(parse(`hi @[田中 太郎](user:${id}) さん`)).trim()).toBe(
			`hi @[田中 太郎](user:${id}) さん`
		);
	});
});
