import { describe, expect, it } from 'vitest';
import {
	adjacent,
	createTile,
	createBoard,
	dailyDateKey,
	type Tile,
	moveCostFor,
	wordMultiplierFor,
	scoringSteps,
	wordFor,
	LETTER_DISTRIBUTION,
	LetterDealer,
	SeededRandom,
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
	it('reproduces the full daily deal and can resume from saved random and pool state', () => {
		const firstRandom = new SeededRandom('2026-09-22');
		const firstDealer = new LetterDealer(firstRandom.next);
		const opening = createBoard(firstDealer);
		const randomState = firstRandom.state;
		const remaining = firstDealer.snapshot();
		const replacements = replaceLetters(opening, [0, 5, 10], firstDealer);

		const matchingRandom = new SeededRandom('2026-09-22');
		expect(createBoard(new LetterDealer(matchingRandom.next))).toEqual(opening);

		const resumedRandom = new SeededRandom(randomState);
		const resumedDealer = new LetterDealer(resumedRandom.next, remaining);
		expect(replaceLetters(opening, [0, 5, 10], resumedDealer)).toEqual(replacements);
	});

	it('uses an ISO UTC date as the daily puzzle id', () => {
		expect(dailyDateKey(new Date('2026-09-22T23:59:59-06:00'))).toBe('2026-09-23');
	});

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
		const board: Tile[] = Array.from({ length: 16 }, () => ({ letter: 'E', type: 'normal' }));
		const dealer = new LetterDealer(() => 0.999);
		const next = replaceLetters(board, [0, 1, 2], dealer);
		expect(next.slice(3)).toEqual(board.slice(3));
		expect(next.slice(0, 3).every((letter) => letter.letter in LETTER_DISTRIBUTION)).toBe(true);
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
		expect(
			scoreFor(
				['Q', 'U', 'I', 'Z'].map((letter) => ({ letter, type: 'normal' })),
				[0, 1, 2, 3]
			)
		).toBe(22);
	});
	it('rejects short, unknown, and repeated words, case insensitively', () => {
		const dictionary = new Set(['at', 'cat']);
		expect(rejectionFor('A', dictionary, new Set())).toBeTruthy();
		expect(rejectionFor('ZZ', dictionary, new Set())).toBeTruthy();
		expect(rejectionFor('CAT', dictionary, new Set(['cat']))).toBeTruthy();
		expect(rejectionFor('AT', dictionary, new Set())).toBeNull();
	});
});

describe('special letters', () => {
	it('deals special types on initial boards and replacements', () => {
		const board = createBoard(new LetterDealer(() => 0));
		expect(board).toHaveLength(16);
		expect(board.every((tile) => tile.type === 'ghost')).toBe(true);
		const next = replaceLetters(board, [0], new LetterDealer(() => 0.1));
		expect(next[0].type).toBe('double');
		expect(next.slice(1)).toEqual(board.slice(1));
	});

	it('uses progressively rarer multiplier values', () => {
		const counts = [0, 0, 0, 0, 0];
		for (let i = 0; i < 100; i++) {
			const draws = [0.2, (i + 0.5) / 100];
			const tile = createTile('A', () => draws.shift()!);
			if (tile.type === 'multiplier') counts[tile.multiplier - 1]++;
		}
		expect(counts).toEqual([60, 25, 10, 4, 1]);
		expect(createTile('A', () => 0.5).type).toBe('normal');
	});

	it('counts doubles twice, ghosts as zero, and adds multiplier bonuses', () => {
		const board: Tile[] = [
			{ letter: 'Q', type: 'ghost' },
			{ letter: 'U', type: 'double' },
			{ letter: 'I', type: 'multiplier', multiplier: 2 },
			{ letter: 'Z', type: 'multiplier', multiplier: 5 }
		];
		const path = [0, 1, 2, 3];
		expect(wordFor(board, path)).toBe('QUIZ');
		expect(scoreFor(board, path)).toBe(2);
		expect(wordMultiplierFor(board, path)).toBe(9);
		expect(scoringSteps(board, path).map((step) => step.points)).toEqual([0, 1, 1, 0, 0]);
		expect(moveCostFor(board, path)).toBe(0);
		expect(moveCostFor(board, [1, 2, 3])).toBe(1);
		expect(scoreFor(board, [0, 2, 3])).toBe(0);
	});
});
