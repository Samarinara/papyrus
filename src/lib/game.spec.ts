import { describe, expect, it } from 'vitest';
import { adjacent, multiplierFor, rejectionFor, scoreFor, selectTile } from './game';

describe('word selection', () => {
	it('accepts diagonal neighbors and rejects row wrapping and distant tiles', () => {
		expect(adjacent(0, 5)).toBe(true);
		expect(adjacent(3, 4)).toBe(false);
		expect(selectTile([0, 1], 15)).toBeNull();
	});
	it('removes the selected tile and everything after it', () => {
		expect(selectTile([0, 1, 5, 6], 1)).toEqual([0]);
		expect(selectTile([0, 1], 0)).toEqual([]);
	});
	it('allows a path using all 16 tiles', () => {
		let path: number[] = [];
		for (const index of [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12]) {
			path = selectTile(path, index)!;
		}
		expect(path).toHaveLength(16);
	});
});
describe('scoring and validation', () => {
	it('uses every multiplier boundary, including words longer than the track', () => {
		expect([0, 1, 3, 4, 6, 7, 8, 9, 10, 16].map(multiplierFor)).toEqual([
			1, 1, 1, 2, 2, 4, 4, 10, 10, 10
		]);
		expect(scoreFor(['Q', 'U', 'I', 'Z'], [0, 1, 2, 3])).toBe(22);
	});
	it('rejects short, unknown, and repeated words, case insensitively', () => {
		const dictionary = new Set(['at', 'cat']);
		expect(rejectionFor('A', dictionary, new Set())).toBeTruthy();
		expect(rejectionFor('ZZ', dictionary, new Set())).toBeTruthy();
		expect(rejectionFor('CAT', dictionary, new Set(['cat']))).toBeTruthy();
		expect(rejectionFor('AT', dictionary, new Set())).toBeNull();
	});
});
