import { describe, expect, it } from 'vitest';
import { customEmojiName, isValidEmojiName, normalizeEmojiName } from './custom-emoji';

describe('normalizeEmojiName', () => {
	it('前後の空白と : を外して小文字にする', () => {
		expect(normalizeEmojiName(' :Party_Parrot: ')).toBe('party_parrot');
	});
});

describe('isValidEmojiName', () => {
	it('文字・数字・_・- だけ、32 文字まで', () => {
		expect(isValidEmojiName('承認-ok_2')).toBe(true);
		expect(isValidEmojiName('a b')).toBe(false);
		expect(isValidEmojiName('a:b')).toBe(false);
		expect(isValidEmojiName('x'.repeat(32))).toBe(true);
		expect(isValidEmojiName('x'.repeat(33))).toBe(false);
	});
});

describe('customEmojiName', () => {
	it(':name: なら name、標準の絵文字なら null', () => {
		expect(customEmojiName(':承認:')).toBe('承認');
		expect(customEmojiName('👍')).toBeNull();
		expect(customEmojiName(':a b:')).toBeNull();
	});
});
