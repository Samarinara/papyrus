import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
	await page.addInitScript(() => {
		let seed = 42;
		Math.random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 2 ** 32;
		};
	});
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
	excluded: string[] = []
): Promise<{ path: number[]; word: string }> {
	return page.evaluate<{ path: number[]; word: string }, string[]>(async (played) => {
		const dictionary = new Set(
			(await (await fetch('/dictionary/words.txt')).text()).trim().split(/\r?\n/)
		);
		const letters = [...document.querySelectorAll<HTMLElement>('[data-tile]')].map(
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
				!blocked.has(word.toLowerCase())
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
	}, excluded);
}

async function playAvailableWord(page: Page, used: string[] = []) {
	const choice = await findPlayablePath(page, used);
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

test('ten accepted words, final score, restart and stored high score', async ({ page }) => {
	test.setTimeout(45_000);
	await setup(page);
	const used: string[] = [];
	for (let move = 0; move < 10; move += 1) {
		const choice = await playAvailableWord(page, used);
		used.push(choice.word);
	}
	await expect(page.getByRole('button', { name: 'Restart' })).toBeVisible();
	const score = await page.locator('.final-score').textContent();
	expect(Number(score)).toBeGreaterThan(0);
	await expect(page.locator('.high-score')).toHaveText(`High score: ${score}`);
	expect(await page.evaluate(() => localStorage.getItem('papyrus.highScore'))).toBe(score);
	await page.getByRole('button', { name: 'Restart' }).click();
	await expect(page.getByTestId('total')).toHaveText('0');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'10'
	);
	await page.reload();
	expect(await page.evaluate(() => localStorage.getItem('papyrus.highScore'))).toBe(score);
});

test('mouse dragging selects a connected word', async ({ page }) => {
	await setup(page);
	const first = (await tile(page, 0).boundingBox())!;
	const last = (await tile(page, 2).boundingBox())!;
	await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 20 });
	await page.mouse.up();
	await expect(page.getByTestId('word-score')).not.toHaveText('0');
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
	await expect(page.getByTestId('word-score')).not.toHaveText('0');
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
	const fourLetterScore = Number(await page.getByTestId('word-score').textContent());
	expect(fourLetterScore).toBeGreaterThan(0);
	await expect(page.getByTestId('multiplier')).toHaveText('2×');
	await expect(page.locator('.connections line')).toHaveCount(3);
	const firstLink = await page.locator('.connections line').first().elementHandle();
	await tile(page, 3).click();
	const threeLetterScore = Number(await page.getByTestId('word-score').textContent());
	expect(threeLetterScore).toBeGreaterThan(0);
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
	await expect(page.getByTestId('word-score')).not.toHaveText('0');
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
