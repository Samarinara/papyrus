import { describe, expect, it } from 'vitest';
import {
	adjacent,
	LETTER_DISTRIBUTION,
	LetterDealer,
	multiplierFor,
	rejectionFor,
	replaceLetters,
	scoreFor,
	selectTile
} from './game';

function seededRandom(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

describe('letter dealer', () => {
	it('depletes a human-frequency pool before refilling', () => {
		const dealer = new LetterDealer(seededRandom(12));
		const poolSize = Object.values(LETTER_DISTRIBUTION).reduce((sum, count) => sum + count, 0);
		const dealt = Array.from({ length: poolSize }, () => dealer.next([]));
		for (const [letter, count] of Object.entries(LETTER_DISTRIBUTION)) {
			expect(dealt.filter((dealtLetter) => dealtLetter === letter)).toHaveLength(count);
		}
	});

	it('makes existing duplicates less likely without banning them', () => {
		let emptyBoardEs = 0;
		let crowdedBoardEs = 0;
		for (let seed = 1; seed <= 500; seed += 1) {
			emptyBoardEs += Number(new LetterDealer(seededRandom(seed)).next([]) === 'E');
			crowdedBoardEs += Number(
				new LetterDealer(seededRandom(seed)).next(Array<string>(16).fill('E')) === 'E'
			);
		}
		expect(crowdedBoardEs).toBeLessThan(emptyBoardEs / 4);
	});

	it('balances replacements against letters that remain on the board', () => {
		const board = Array<string>(16).fill('E');
		const dealer = new LetterDealer(() => 0.999);
		const next = replaceLetters(board, [0, 1, 2], dealer);
		expect(next.slice(3)).toEqual(Array<string>(13).fill('E'));
		expect(next.slice(0, 3).every((letter) => letter in LETTER_DISTRIBUTION)).toBe(true);
	});
});

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
