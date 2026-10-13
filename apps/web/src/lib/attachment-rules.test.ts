import { describe, expect, it } from 'vitest';
import { formatBytes, markdownFor, shouldUploadPaste } from './attachment-rules';

describe('markdownFor', () => {
	const url = '/projects/ACME/attachments/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

	it('画像は ![]()、それ以外は []()', () => {
		expect(markdownFor({ filename: 'a.png', url, isImage: true })).toBe(`![a.png](${url})`);
		expect(markdownFor({ filename: 'a.pdf', url, isImage: false })).toBe(`[a.pdf](${url})`);
	});

	it('ファイル名の [ ] \\ をエスケープしてリンクを壊さない', () => {
		expect(markdownFor({ filename: '仕様書 (最終) [v2]\\.pdf', url, isImage: false })).toBe(
			`[仕様書 (最終) \\[v2\\]\\\\.pdf](${url})`
		);
	});
});

describe('formatBytes', () => {
	it('B / KB / MB で表示する', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
	});
});

describe('shouldUploadPaste', () => {
	it('スクリーンショット（ファイルのみ）はアップロードする', () => {
		expect(shouldUploadPaste(['Files'], 1)).toBe(true);
	});

	it('Excel・Word のようにテキストと画像を両方持つ貼り付けはテキストとして扱う', () => {
		expect(shouldUploadPaste(['text/plain', 'text/html', 'Files'], 1)).toBe(false);
	});

	it('ファイルがなければアップロードしない', () => {
		expect(shouldUploadPaste(['text/plain'], 0)).toBe(false);
	});
});
