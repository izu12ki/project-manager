// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { createMarkdownEditor } from './create-editor';
import { currentMentionQuery, insertMention, shouldHandleMenuKey } from './mention-query';

const id = '0192f0c1-0000-7000-8000-000000000001';

function setup(text: string) {
	const h = createMarkdownEditor({});
	h.editor.update(
		() => {
			const t = $createTextNode(text);
			$getRoot().clear().append($createParagraphNode().append(t));
			t.select(text.length, text.length);
		},
		{ discrete: true }
	);
	return h;
}

describe('mention-query', () => {
	it('@ の後の文字列を返す', () => {
		expect(currentMentionQuery(setup('hi @ta').editor)?.query).toBe('ta');
	});

	it('@ がなければ null', () => {
		expect(currentMentionQuery(setup('hi ta').editor)).toBeNull();
	});

	it('確定で @query がメンションに置き換わる', () => {
		const h = setup('hi @ta');
		insertMention(h.editor, { id, name: '田中' });
		expect(h.getMarkdown()).toBe(`hi @[田中](user:${id}) `);
		expect(currentMentionQuery(h.editor)).toBeNull();
	});

	it('文の途中でも手前の @query だけを置き換える', () => {
		const h = setup('a @ta b');
		h.editor.update(
			() => {
				const t = $getRoot().getFirstDescendant()!;
				(t as import('lexical').TextNode).select(5, 5);
			},
			{ discrete: true }
		);
		insertMention(h.editor, { id, name: '田中' });
		expect(h.getMarkdown()).toBe(`a @[田中](user:${id})  b`);
	});

	it('変換中の Enter は扱わない', () => {
		expect(
			shouldHandleMenuKey(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
		).toBe(false);
		expect(shouldHandleMenuKey(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
	});
});
