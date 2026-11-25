import { describe, expect, it } from 'vitest';
import { lastPage, pageItems, parsePage, withPage } from './pagination';

const params = (s: string) => new URLSearchParams(s);

describe('pagination', () => {
	it('URL のページを 1 以上の整数として読む。不正な値は 1', () => {
		expect(parsePage(params(''))).toBe(1);
		expect(parsePage(params('page=3'))).toBe(3);
		for (const bad of ['0', '-2', '1.5', 'abc', '3x', '', '99999999999']) {
			expect(parsePage(params(`page=${bad}`)), bad).toBe(1);
		}
	});

	it('最後のページ。0 件でも 1', () => {
		expect(lastPage(0, 50)).toBe(1);
		expect(lastPage(50, 50)).toBe(1);
		expect(lastPage(51, 50)).toBe(2);
		expect(lastPage(3000, 50)).toBe(60);
	});

	it('ページ番号の並び。先頭・末尾と現在の前後 2 ページ、間が空くところは null', () => {
		expect(pageItems(1, 1)).toEqual([1]);
		expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(pageItems(1, 60)).toEqual([1, 2, 3, null, 60]);
		expect(pageItems(6, 60)).toEqual([1, null, 4, 5, 6, 7, 8, null, 60]);
		expect(pageItems(60, 60)).toEqual([1, null, 58, 59, 60]);
		// 1 ページだけ飛ぶところは「…」にせず番号を出す
		expect(pageItems(4, 60)).toEqual([1, 2, 3, 4, 5, 6, null, 60]);
		expect(pageItems(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('ページだけを差し替えたクエリ文字列。1 ページ目は page を付けない', () => {
		const q = params('status=todo&page=2&sort=due&order=asc');
		expect(withPage(q, 3)).toBe('?status=todo&page=3&sort=due&order=asc');
		expect(withPage(q, 1)).toBe('?status=todo&sort=due&order=asc');
		expect(withPage(params('page=4'), 1)).toBe('');
	});
});
