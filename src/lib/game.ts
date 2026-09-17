export const LETTER_SCORES: Record<string, number> = {
	A: 1,
	B: 3,
	C: 3,
	D: 2,
	E: 1,
	F: 4,
	G: 2,
	H: 4,
	I: 1,
	J: 8,
	K: 5,
	L: 1,
	M: 3,
	N: 1,
	O: 1,
	P: 3,
	Q: 10,
	R: 1,
	S: 1,
	T: 1,
	U: 1,
	V: 4,
	W: 4,
	X: 8,
	Y: 4,
	Z: 10
};

export const HIGH_SCORE_KEY = 'papyrus.highScore';

// Rounded English letter frequencies. Keeping at least one of every letter in the
// pool prevents rare letters from disappearing indefinitely, while depletion
// prevents independent random draws from producing unlimited streaks.
export const LETTER_DISTRIBUTION: Readonly<Record<string, number>> = {
	A: 8,
	B: 2,
	C: 3,
	D: 4,
	E: 12,
	F: 2,
	G: 2,
	H: 6,
	I: 7,
	J: 1,
	K: 1,
	L: 4,
	M: 2,
	N: 7,
	O: 8,
	P: 2,
	Q: 1,
	R: 6,
	S: 6,
	T: 9,
	U: 3,
	V: 1,
	W: 2,
	X: 1,
	Y: 2,
	Z: 1
};

export type Tile = { letter: string } & (
	{ type: 'normal' | 'ghost' | 'double' } | { type: 'multiplier'; multiplier: 1 | 2 | 3 | 4 | 5 }
);

/** Special types are independent of the balanced letter pool. */
export function createTile(letter: string, random: () => number = Math.random): Tile {
	const roll = random();
	if (roll < 0.06) return { letter, type: 'ghost' };
	if (roll < 0.16) return { letter, type: 'double' };
	if (roll < 0.26) {
		// Conditional probabilities: 60%, 25%, 10%, 4%, 1%.
		const value = random();
		const multiplier = value < 0.6 ? 1 : value < 0.85 ? 2 : value < 0.95 ? 3 : value < 0.99 ? 4 : 5;
		return { letter, type: 'multiplier', multiplier };
	}
	return { letter, type: 'normal' };
}

export const tilePoints = (tile: Tile) =>
	tile.type === 'ghost' || tile.type === 'multiplier' ? 0 : LETTER_SCORES[tile.letter];
export const tileLabel = (tile: Tile) => {
	if (tile.type === 'ghost') return `${tile.letter}, ghost, 0 points, word costs no move`;
	if (tile.type === 'double') return `${tile.letter}, double, ${tilePoints(tile)} points twice`;
	if (tile.type === 'multiplier') return `${tile.letter}, adds ${tile.multiplier} to multiplier`;
	return `${tile.letter}, ${tilePoints(tile)} points`;
};

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
const duplicateWeight = (copies: number) => [1, 0.42, 0.12, 0.03][Math.min(copies, 3)];

/** A finite, board-aware letter pool. A custom random source keeps it easy to test. */
export class LetterDealer {
	private remaining: Record<string, number> = {};

	constructor(private readonly random: () => number = Math.random) {
		this.refill();
	}

	private refill() {
		this.remaining = { ...LETTER_DISTRIBUTION };
	}

	nextTile(board: readonly Tile[]): Tile {
		return createTile(this.next(board.map((tile) => tile.letter)), this.random);
	}

	next(board: readonly string[]): string {
		if (!Object.values(this.remaining).some(Boolean)) this.refill();

		const boardCounts = board.reduce<Record<string, number>>((counts, letter) => {
			counts[letter] = (counts[letter] ?? 0) + 1;
			return counts;
		}, {});
		const vowelCount = board.reduce((count, letter) => count + Number(VOWELS.has(letter)), 0);
		const vowelShare = board.length ? vowelCount / board.length : 0.4;
		const choices = Object.entries(this.remaining)
			.filter(([, count]) => count > 0)
			.map(([letter, count]) => {
				const isVowel = VOWELS.has(letter);
				// This is deliberately a soft correction. Awkward boards and duplicate
				// letters can still occur, but they become progressively less likely.
				const balance = isVowel
					? vowelShare < 0.32
						? 1.65
						: vowelShare > 0.52
							? 0.45
							: 1
					: vowelShare > 0.48
						? 1.45
						: vowelShare < 0.28
							? 0.65
							: 1;
				return {
					letter,
					weight: count * duplicateWeight(boardCounts[letter] ?? 0) * balance
				};
			});
		const totalWeight = choices.reduce((total, choice) => total + choice.weight, 0);
		let target = Math.min(Math.max(this.random(), 0), 1 - Number.EPSILON) * totalWeight;
		const selected =
			choices.find((choice) => {
				target -= choice.weight;
				return target < 0;
			}) ?? choices[choices.length - 1];
		this.remaining[selected.letter] -= 1;
		return selected.letter;
	}
}

export const createBoard = (dealer = new LetterDealer()) => {
	const board: Tile[] = [];
	while (board.length < 16) board.push(dealer.nextTile(board));
	return board;
};

export function replaceLetters(board: Tile[], indices: readonly number[], dealer: LetterDealer) {
	const replaced = new Set(indices);
	const next = [...board];
	const visible = board.filter((_, index) => !replaced.has(index));
	for (const index of indices) {
		const letter = dealer.nextTile(visible);
		next[index] = letter;
		visible.push(letter);
	}
	return next;
}
export const multiplierFor = (length: number) =>
	length >= 9 ? 10 : length >= 7 ? 4 : length >= 4 ? 2 : 1;
export function scoringSteps(board: readonly Tile[], path: readonly number[]) {
	return path.flatMap((index) => {
		const tile = board[index];
		const step = {
			index,
			points: tilePoints(tile),
			multiplier: tile.type === 'multiplier' ? tile.multiplier : 0
		};
		return tile.type === 'double' ? [step, { ...step }] : [step];
	});
}
export const scoreFor = (board: readonly Tile[], path: readonly number[]) =>
	scoringSteps(board, path).reduce((score, step) => score + step.points, 0);
export const wordMultiplierFor = (board: readonly Tile[], path: readonly number[]) =>
	multiplierFor(path.length) +
	scoringSteps(board, path).reduce((sum, step) => sum + step.multiplier, 0);
export const moveCostFor = (board: readonly Tile[], path: readonly number[]) =>
	path.some((index) => board[index].type === 'ghost') ? 0 : 1;
export const wordFor = (board: readonly Tile[], path: readonly number[]) =>
	path.map((index) => board[index].letter).join('');
export function adjacent(a: number, b: number) {
	return (
		a !== b &&
		Math.abs((a % 4) - (b % 4)) <= 1 &&
		Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) <= 1
	);
}
export function selectTile(path: number[], index: number): number[] | null {
	const previous = path.indexOf(index);
	if (previous !== -1) return path.slice(0, previous);
	if (path.length && !adjacent(path[path.length - 1], index)) return null;
	return [...path, index];
}
export function rejectionFor(
	word: string,
	dictionary: Set<string>,
	used: Set<string>
): string | null {
	if (word.length < 2) return 'Choose at least 2 letters.';
	if (used.has(word.toLowerCase())) return 'That word has already been played.';
	if (!dictionary.has(word.toLowerCase())) return 'That word is not in the dictionary.';
	return null;
}
