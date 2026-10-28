import { describe, expect, it } from 'vitest';
import { reactorsLabel, toggleReactionIn } from './reactions';

const a = { id: 'a', name: 'A' };
const b = { id: 'b', name: 'B' };

describe('toggleReactionIn', () => {
	it('まだない絵文字は末尾に足す', () => {
		expect(toggleReactionIn([{ emoji: '👍', users: [a] }], '🎉', b)).toEqual([
			{ emoji: '👍', users: [a] },
			{ emoji: '🎉', users: [b] }
		]);
	});

	it('付けていれば外し、誰もいなくなった絵文字は消す', () => {
		const groups = [
			{ emoji: '👍', users: [a, b] },
			{ emoji: '🎉', users: [b] }
		];
		expect(toggleReactionIn(groups, '👍', b)).toEqual([{ emoji: '👍', users: [a] }, groups[1]]);
		expect(toggleReactionIn(groups, '🎉', b)).toEqual([groups[0]]);
	});

	it('付けていなければ人を足す', () => {
		expect(toggleReactionIn([{ emoji: '👍', users: [a] }], '👍', b)).toEqual([
			{ emoji: '👍', users: [a, b] }
		]);
	});
});

describe('reactorsLabel', () => {
	it('多いときは「他 N 人」にまとめる', () => {
		expect(reactorsLabel([a, b])).toBe('A、B');
		expect(reactorsLabel([a, b, { name: 'C' }], 2)).toBe('A、B 他 1 人');
	});
});
