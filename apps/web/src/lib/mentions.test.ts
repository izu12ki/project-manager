import { describe, expect, it } from 'vitest';
import {
	extractMentionIds,
	filterCandidates,
	findMentionQuery,
	mentionToken,
	mentionsToPlain
} from './mentions';

const A = '0192f0c1-0000-7000-8000-000000000001';
const B = '0192f0c1-0000-7000-8000-000000000002';

describe('mentionToken', () => {
	it('表示名と ID からトークンを作る', () => {
		expect(mentionToken({ id: A, name: '田中 太郎' })).toBe(`@[田中 太郎](user:${A})`);
	});
	it('表示名の ] と改行は除く', () => {
		expect(mentionToken({ id: A, name: 'a]b\nc' })).toBe(`@[abc](user:${A})`);
	});
	it('除いた結果が空なら ? にする', () => {
		expect(mentionToken({ id: A, name: ']' })).toBe(`@[?](user:${A})`);
	});
});

describe('extractMentionIds', () => {
	it('重複を除いて ID を取り出す', () => {
		const t = `${mentionToken({ id: A, name: 'a' })} と ${mentionToken({ id: B, name: 'b' })} と ${mentionToken({ id: A, name: 'a' })}`;
		expect(extractMentionIds(t)).toEqual([A, B]);
	});
	it('UUID でない ID は無視する', () => {
		expect(extractMentionIds('@[a](user:abc)')).toEqual([]);
	});
	it('インラインコードとコードブロックの中は無視する', () => {
		const tok = mentionToken({ id: A, name: 'a' });
		expect(extractMentionIds('`' + tok + '`')).toEqual([]);
		expect(extractMentionIds('```\n' + tok + '\n```')).toEqual([]);
		expect(
			extractMentionIds('```\n' + tok + '\n```\n' + mentionToken({ id: B, name: 'b' }))
		).toEqual([B]);
	});
	it('トークンから作った ID はそのまま取り出せる（表示名に ] を含む人）', () => {
		expect(extractMentionIds(mentionToken({ id: A, name: 'x]y' }))).toEqual([A]);
	});
});

describe('mentionsToPlain', () => {
	it('記法を @表示名 にする', () => {
		expect(mentionsToPlain(`hi ${mentionToken({ id: A, name: '田中' })}!`)).toBe('hi @田中!');
	});
});

describe('findMentionQuery', () => {
	it('行頭・空白直後の @ からキャレットまでを返す', () => {
		expect(findMentionQuery('@ta', 3)).toEqual({ start: 0, query: 'ta' });
		expect(findMentionQuery('hello @田', 8)).toEqual({ start: 6, query: '田' });
		expect(findMentionQuery('a\n@', 3)).toEqual({ start: 2, query: '' });
	});
	it('メールアドレスや空白を挟んだ場合は null', () => {
		expect(findMentionQuery('mail@ex', 7)).toBeNull();
		expect(findMentionQuery('@ta ro', 6)).toBeNull();
		expect(findMentionQuery('abc', 3)).toBeNull();
	});
});

describe('filterCandidates', () => {
	const cands = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `User${i}` }));
	it('大文字小文字を無視して部分一致し、最大 8 件', () => {
		expect(filterCandidates(cands, 'user')).toHaveLength(8);
		expect(filterCandidates(cands, 'R3').map((c) => c.id)).toEqual(['3']);
		expect(filterCandidates([{ id: 'x', name: '顧客 太郎' }], '太郎')).toHaveLength(1);
	});
});
