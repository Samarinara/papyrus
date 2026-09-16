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

// Standard English Scrabble distribution, with no blank tiles.
const LETTER_BAG =
	'AAAAAAAAABBCCDDDDEEEEEEEEEEEEFFGGGHHIIIIIIIIIJKLLLLMMNNNNNNOOOOOOOOPPQRRRRRRSSSSTTTTTTUUUUVVWWXYYZ';
export const HIGH_SCORE_KEY = 'papyrus.highScore';
export const randomLetter = () => LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)];
export const createBoard = () => Array.from({ length: 16 }, randomLetter);
export const multiplierFor = (length: number) =>
	length >= 9 ? 10 : length >= 7 ? 4 : length >= 4 ? 2 : 1;
export const scoreFor = (board: string[], path: number[]) =>
	path.reduce((score, index) => score + LETTER_SCORES[board[index]], 0);
export const wordFor = (board: string[], path: number[]) =>
	path.map((index) => board[index]).join('');
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
