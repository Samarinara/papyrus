import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
	await page.goto('/');
	// The bundled dictionary can take longer to load on a busy development machine.
	await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled({
		timeout: 15000
	});
}
const tile = (page: Page, index: number) => page.locator(`[data-tile="${index}"]`);
async function play(page: Page, path: number[]) {
	for (const index of path) await tile(page, index).click();
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => !document.querySelector('.scoreboard.scoring'), null, {
		timeout: 5000
	});
}

async function findPlayablePath(
	page: Page,
	excluded: string[] = [],
	paidOnly = false
): Promise<{ path: number[]; word: string }> {
	return page.evaluate<{ path: number[]; word: string }, { played: string[]; paidOnly: boolean }>(
		async ({ played, paidOnly }) => {
			const dictionary = new Set(
				(await (await fetch('/dictionary/words.txt')).text()).trim().split(/\r?\n/)
			);
			const tiles = [...document.querySelectorAll<HTMLElement>('[data-tile]')];
			const letters = tiles.map(
				(element) => element.querySelector<HTMLElement>('.letter')!.textContent!
			);
			const blocked = new Set(played);
			const adjacent = (a: number, b: number) =>
				a !== b &&
				Math.abs((a % 4) - (b % 4)) <= 1 &&
				Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) <= 1;
			let answer: { path: number[]; word: string } | null = null;
			const visit = (path: number[], word: string) => {
				if (answer || path.length > 7) return;
				if (
					path.length >= 2 &&
					dictionary.has(word.toLowerCase()) &&
					!blocked.has(word.toLowerCase()) &&
					(!paidOnly || path.every((index) => tiles[index].dataset.type !== 'ghost'))
				) {
					answer = { path, word: word.toLowerCase() };
					return;
				}
				for (let next = 0; next < letters.length; next += 1) {
					if (!path.includes(next) && adjacent(path[path.length - 1], next)) {
						visit([...path, next], word + letters[next]);
					}
				}
			};
			for (let start = 0; start < letters.length && !answer; start += 1) {
				visit([start], letters[start]);
			}
			if (!answer) throw new Error('No playable word found on board');
			return answer;
		},
		{ played: excluded, paidOnly }
	);
}

async function playAvailableWord(page: Page, used: string[] = [], paidOnly = false) {
	const choice = await findPlayablePath(page, used, paidOnly);
	await play(page, choice.path);
	return choice;
}

test('keyboard, adjacency errors, backtracking, invalid words and replacement', async ({
	page
}) => {
	await setup(page);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Space');
	await expect(tile(page, 0)).toHaveAttribute('aria-pressed', 'true');
	await tile(page, 15).click();
	await expect(tile(page, 15)).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status')).toHaveText('Choose at least 2 letters.');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'10'
	);
	await tile(page, 1).click();
	await tile(page, 2).click();
	await tile(page, 1).click();
	await expect(page.getByRole('meter', { name: 'Selected letters' })).toHaveAttribute(
		'aria-valuenow',
		'1'
	);
	await tile(page, 0).click();
	const choice = await findPlayablePath(page);
	await play(page, choice.path);
	await expect(page.getByTestId('total')).not.toHaveText('0');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'9'
	);
});

test('daily selection and accepted progress survive reloads', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await setup(page);
	const opening = await page.locator('[data-tile]').evaluateAll((tiles) =>
		tiles.map((tile) => ({
			letter: tile.querySelector('.letter')!.textContent,
			type: tile.getAttribute('data-type')
		}))
	);
	await tile(page, 0).click();
	await tile(page, 1).click();
	await page.reload();
	await expect(tile(page, 0)).toHaveAttribute('aria-pressed', 'true');
	await expect(tile(page, 1)).toHaveAttribute('aria-pressed', 'true');
	await expect(
		page.locator('[data-tile]').evaluateAll((tiles) =>
			tiles.map((tile) => ({
				letter: tile.querySelector('.letter')!.textContent,
				type: tile.getAttribute('data-type')
			}))
		)
	).resolves.toEqual(opening);

	await tile(page, 0).click();
	await playAvailableWord(page);
	const savedTotal = await page.getByTestId('total').textContent();
	const savedMoves = await page
		.getByRole('meter', { name: 'Moves remaining' })
		.getAttribute('aria-valuenow');
	await page.reload();
	await expect(page.getByTestId('total')).toHaveText(savedTotal!);
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		savedMoves!
	);
});

test('one completed daily attempt is stored and remains locked after reload', async ({ page }) => {
	await setup(page);
	await page.evaluate(() => {
		const archive = JSON.parse(localStorage.getItem('papyrus.dailyGames.v1')!);
		const today = new Date().toISOString().slice(0, 10);
		archive.days[today].moves = 1;
		archive.days['2026-09-21'] = {
			...archive.days[today],
			path: [],
			moves: 0,
			total: 1,
			completed: true
		};
		localStorage.setItem('papyrus.dailyGames.v1', JSON.stringify(archive));
	});
	await page.reload();
	await playAvailableWord(page, [], true);
	await expect(page.getByText('Your next puzzle arrives tomorrow.')).toBeVisible();
	const score = await page.locator('.final-score').textContent();
	expect(Number(score)).toBeGreaterThan(0);
	await expect(page.locator('.high-score')).toHaveText(`High score: ${score}`);
	const stored = await page.evaluate(() => {
		const archive = JSON.parse(localStorage.getItem('papyrus.dailyGames.v1')!);
		return {
			today: archive.days[new Date().toISOString().slice(0, 10)],
			previous: archive.days['2026-09-21']
		};
	});
	expect(stored.today.completed).toBe(true);
	expect(stored.today.total).toBe(Number(score));
	expect(stored.previous.total).toBe(1);
	await page.reload();
	await expect(page.getByText('Your next puzzle arrives tomorrow.')).toBeVisible();
	await expect(page.locator('.final-score')).toHaveText(score!);
	await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0);
});

test('mouse dragging selects a connected word', async ({ page }) => {
	await setup(page);
	const first = (await tile(page, 0).boundingBox())!;
	const last = (await tile(page, 2).boundingBox())!;
	await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 20 });
	await page.mouse.up();
	await expect(page.getByTestId('word-score')).toHaveText('0');
	await expect(page.getByRole('meter', { name: 'Selected letters' })).toHaveAttribute(
		'aria-valuenow',
		'3'
	);
	await expect(page.locator('.connections line')).toHaveCount(2);
	await expect(page.locator('.connections line').last()).toHaveAttribute('x2', '250');
});

test('touch dragging and small-screen layout', async ({ browser }) => {
	const context = await browser.newContext({
		baseURL: 'http://localhost:4173',
		viewport: { width: 375, height: 667 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	await setup(page);
	const client = await context.newCDPSession(page);
	for (const [step, index] of [0, 1, 2].entries()) {
		const box = (await tile(page, index).boundingBox())!;
		await client.send('Input.dispatchTouchEvent', {
			type: step === 0 ? 'touchStart' : 'touchMove',
			touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
		});
	}
	await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(page.getByTestId('word-score')).toHaveText('0');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await context.close();
});

test('rapid selections settle correctly and backtracking removes only trailing links', async ({
	page
}) => {
	await setup(page);
	await page.evaluate(async () => {
		for (const index of [0, 1, 2, 3]) {
			document.querySelector<HTMLButtonElement>(`[data-tile="${index}"]`)!.click();
			// Let the tween start, then interrupt it with the next selection.
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
		}
	});
	await expect(page.getByTestId('word-score')).toHaveText('0');
	await expect(page.getByTestId('multiplier')).toHaveText('2×');
	await expect(page.locator('.connections line')).toHaveCount(3);
	const firstLink = await page.locator('.connections line').first().elementHandle();
	await tile(page, 3).click();
	await expect(page.getByTestId('word-score')).toHaveText('0');
	await expect(page.getByTestId('multiplier')).toHaveText('1×');
	await expect(page.locator('.connections line')).toHaveCount(2);
	expect(await firstLink!.evaluate((node) => node.isConnected)).toBe(true);
	const releaseDelays = await page.evaluate(async () => {
		document.querySelector<HTMLButtonElement>('[data-tile="0"]')!.click();
		await new Promise(requestAnimationFrame);
		return [...document.querySelectorAll<HTMLElement>('.tile.deselecting')].map((element) =>
			element.style.getPropertyValue('--deselect-delay')
		);
	});
	expect(releaseDelays.slice(0, 3)).toEqual(['0ms', '45ms', '90ms']);
	await playAvailableWord(page);
	await expect(page.getByTestId('total')).not.toHaveText('0');
	await expect(page.locator('.award-points')).not.toHaveText('+0');
	await expect(page.locator('.connections line')).toHaveCount(0);
	await expect(page.getByTestId('word-score')).toHaveText('0');
});

test('reduced motion keeps scores immediate and responds to preference changes', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await setup(page);
	await playAvailableWord(page);
	await expect(page.getByTestId('total')).not.toHaveText('0');
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.evaluate(() => {
		document.querySelector<HTMLButtonElement>('[data-tile="0"]')!.click();
	});
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(page.getByTestId('word-score')).toHaveText('0');
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('submitted letters count into the word score one at a time', async ({ page }) => {
	await setup(page);
	const choice = await findPlayablePath(page);
	for (const index of choice.path) await tile(page, index).click();
	await expect(page.getByTestId('word-score')).toHaveText('0');
	await page.keyboard.press('Enter');
	await expect(page.locator('.tile.counting')).toHaveCount(1);
	await expect(page.getByTestId('word-score')).not.toHaveText('0');
	await expect(page.locator('.tile.counted')).toHaveCount(choice.path.length);
	await page.waitForFunction(() => !document.querySelector('.scoreboard.scoring'));
	await expect(page.getByTestId('word-score')).toHaveText('0');
	await expect(page.getByTestId('total')).not.toHaveText('0');
});

async function setupSpecial(
	page: Page,
	tiles: Array<
		| { letter: string; type: 'normal' | 'ghost' | 'double' }
		| { letter: string; type: 'multiplier'; multiplier: 1 | 2 | 3 | 4 | 5 }
	>
) {
	await page.addInitScript((board) => {
		const day = new Date().toISOString().slice(0, 10);
		const remaining = Object.fromEntries(
			'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((key) => [key, 4])
		);
		localStorage.setItem(
			'papyrus.dailyGames.v1',
			JSON.stringify({
				version: 1,
				days: {
					[day]: {
						board,
						path: [],
						moves: 10,
						total: 0,
						used: [],
						randomState: 1,
						remaining,
						completed: false
					}
				}
			})
		);
	}, tiles);
	await page.route('**/dictionary/words.txt', (route) => route.fulfill({ body: 'aa' }));
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
}

test('ghost words score zero, preserve moves, replace tiles and reject repeats', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await setupSpecial(
		page,
		Array.from({ length: 16 }, () => ({ letter: 'A', type: 'ghost' as const }))
	);
	await expect(tile(page, 0)).toHaveAttribute('data-type', 'ghost');
	await expect(tile(page, 0).locator('.tile-face')).toHaveCSS(
		'background-color',
		'rgba(0, 0, 0, 0)'
	);
	await tile(page, 0).click();
	await tile(page, 1).click();
	await expect(page.locator('.free-word')).toHaveText('Ghost word · no move used');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
	await expect(page.getByTestId('total')).toHaveText('0');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'10'
	);
	await expect(tile(page, 0).locator('.letter')).not.toHaveText('A');
	await tile(page, 2).click();
	await tile(page, 3).click();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status')).toHaveText('That word has already been played.');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'10'
	);
});

test('double letters count twice and multiplier letters increase only the multiplier', async ({
	page
}) => {
	await setupSpecial(page, [
		{ letter: 'A', type: 'double' },
		{ letter: 'A', type: 'multiplier', multiplier: 5 },
		...Array.from({ length: 14 }, () => ({ letter: 'A', type: 'normal' as const }))
	]);
	await expect(tile(page, 0)).toHaveAttribute('data-type', 'double');
	await expect(tile(page, 1).locator('.letter-score')).toHaveText('×5');
	await tile(page, 0).click();
	await tile(page, 1).click();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('word-score')).toHaveText('1');
	await expect(page.getByTestId('word-score')).toHaveText('2');
	await expect(page.getByTestId('multiplier')).toHaveText('6×');
	await expect(page.locator('.award-formula')).toHaveText('2 × 6');
	await expect(page.getByTestId('total')).toHaveText('12');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'9'
	);
});

test('help modal contains focus, blocks game keys and restores the trigger', async ({ page }) => {
	await setup(page);
	await tile(page, 0).click();
	const help = page.getByRole('button', { name: 'How to play' });
	await help.click();
	const dialog = page.getByRole('dialog', { name: 'How to play' });
	await expect(dialog).toBeVisible();
	const close = dialog.getByRole('button', { name: 'Close help' });
	await expect(close).toBeFocused();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(close).toBeFocused();
	await expect(page.getByRole('meter', { name: 'Selected letters' })).toHaveAttribute(
		'aria-valuenow',
		'1'
	);
	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
	await expect(help).toBeFocused();
	await help.click();
	await close.click();
	await expect(dialog).not.toBeVisible();
	await expect(help).toBeFocused();
});

test('word validity switches without moving the grid or looping animation', async ({ page }) => {
	await setupSpecial(
		page,
		Array.from({ length: 16 }, () => ({ letter: 'A', type: 'normal' as const }))
	);
	const status = page.locator('.word-status');
	const grid = page.getByRole('group', { name: 'Letter grid' });
	const initial = await grid.boundingBox();
	await expect(status).toHaveText('');
	await tile(page, 0).click();
	await expect(status).toHaveText('Not In Dictionary');
	await tile(page, 1).click();
	await expect(status).toHaveText('Valid Word');
	expect(await grid.boundingBox()).toEqual(initial);
	expect(
		await status.locator('span').evaluate((el) => getComputedStyle(el).animationIterationCount)
	).toBe('1');
	await tile(page, 1).click();
	await expect(status).toHaveText('Not In Dictionary');
	await tile(page, 0).click();
	await expect(status).toHaveText('');
});

for (const width of [320, 375, 600, 1024]) {
	test(`scoreboard layout at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 740 });
		await setup(page);
		const scores = (await page.locator('.scoreboard').boundingBox())!;
		const grid = (await page.getByRole('group', { name: 'Letter grid' }).boundingBox())!;
		if (width <= 600) expect(scores.y + scores.height).toBeLessThan(grid.y);
		else expect(scores.x).toBeGreaterThan(grid.x + grid.width);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.getByRole('button', { name: 'How to play' }).click();
		const dialog = (await page.getByRole('dialog').boundingBox())!;
		expect(dialog.x).toBeGreaterThanOrEqual(0);
		expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
		expect(dialog.height).toBeLessThanOrEqual(740);
	});
}
