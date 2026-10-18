// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertUploads, onPendingUploadsChange, pendingUploads } from './attachment-upload';

afterEach(() => vi.unstubAllGlobals());

describe('pendingUploads', () => {
	it('textarea へのアップロードが終わるまで件数を数え、変わるたびに知らせる', async () => {
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await held;
				return new Response(
					JSON.stringify({
						id: '1',
						url: '/projects/A/attachments/1',
						filename: 'a.png',
						isImage: true
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);
		const el = document.createElement('textarea');
		const other = document.createElement('textarea');
		const seen: number[] = [];
		const off = onPendingUploadsChange(el, (n) => seen.push(n));

		const files = [new File(['x'], 'a.png'), new File(['y'], 'b.png')];
		const done = insertUploads(el, 'A', files);
		expect(pendingUploads(el)).toBe(2);
		expect(pendingUploads(other)).toBe(0);
		release();
		await done;
		expect(pendingUploads(el)).toBe(0);
		expect(seen.at(0)).toBe(2);
		expect(seen.at(-1)).toBe(0);
		// 2 件の間で 0 にならない（その隙にモードを切り替えさせない）
		expect(seen.slice(0, -1)).not.toContain(0);
		expect(el.value).toContain('![a.png](/projects/A/attachments/1)');

		off();
		const before = seen.length;
		await insertUploads(el, 'A', [new File(['z'], 'c.png')]);
		expect(seen.length).toBe(before);
	});
});
