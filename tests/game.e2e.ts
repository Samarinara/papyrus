import { expect, test, type Page } from '@playwright/test';

const letters = 'CATSTERNOUSELINE';
async function setup(page: Page) {
	await page.addInitScript((initial) => {
		const bag =
			'AAAAAAAAABBCCDDDDEEEEEEEEEEEEFFGGGHHIIIIIIIIIJKLLLLMMNNNNNNOOOOOOOOPPQRRRRRRSSSSTTTTTTUUUUVVWWXYYZ';
		const state = window as unknown as { nextLetters: string[] };
		state.nextLetters = initial.split('');
		Math.random = () => (bag.indexOf(state.nextLetters.shift() ?? 'E') + 0.5) / bag.length;
	}, letters);
	await page.goto('/');
	// The bundled dictionary can take longer to load on a busy development machine.
	await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled({
		timeout: 15000
	});
}
const tile = (page: Page, index: number) => page.locator(`[data-tile="${index}"]`);
async function play(page: Page, path: number[]) {
	await page.evaluate(
		(replacement) => {
			(window as unknown as { nextLetters: string[] }).nextLetters = replacement;
		},
		[...path].sort((a, b) => a - b).map((index) => letters[index])
	);
	for (const index of path) await tile(page, index).click();
	await page.keyboard.press('Enter');
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
	await expect(tile(page, 15)).toHaveClass(/invalid/);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status')).toHaveText('Choose at least 2 letters.');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'10'
	);
	await tile(page, 1).click();
	await tile(page, 2).click();
	await expect(page.getByTestId('word-score')).toHaveText('5');
	await tile(page, 1).click();
	await expect(page.getByRole('meter', { name: 'Selected letters' })).toHaveAttribute(
		'aria-valuenow',
		'1'
	);
	await tile(page, 1).click();
	await tile(page, 2).click();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('total')).toHaveText('5');
	await expect(page.getByRole('img', { name: 'Game total: 5', exact: true })).toBeVisible();
	await expect(tile(page, 0)).toContainText('E');
	await expect(tile(page, 3)).toContainText('S');
	await tile(page, 0).click();
	await tile(page, 1).click();
	await tile(page, 2).click();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status')).toHaveText('That word is not in the dictionary.');
	await expect(page.getByRole('meter', { name: 'Moves remaining' })).toHaveAttribute(
		'aria-valuenow',
		'9'
	);
});

test('ten accepted words, repeat rejection, final score, restart and stored high score', async ({
	page
}) => {
	await setup(page);
	await play(page, [0, 1, 2]);
	await play(page, [0, 1, 2]);
	await expect(page.getByRole('status')).toHaveText('That word has already been played.');
	await tile(page, 0).click();
	// With this grid, use CAT, CATS, AT, TEA, STAR, EAT, RAT, TAR, TEAR, RATE.
	for (const path of [
		[0, 1, 2, 3],
		[1, 2],
		[4, 5, 1],
		[3, 2, 1, 6],
		[5, 1, 2],
		[6, 1, 2],
		[2, 1, 6],
		[4, 5, 1, 6],
		[6, 1, 2, 5]
	]) {
		await play(page, path);
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
	await expect(page.getByTestId('word-score')).toHaveText('5');
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
	await expect(page.getByTestId('word-score')).toHaveText('5');
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
	await expect(page.getByTestId('word-score')).toHaveText('6');
	await expect(page.getByTestId('multiplier')).toHaveText('2×');
	await expect(page.locator('.connections line')).toHaveCount(3);
	const firstLink = await page.locator('.connections line').first().elementHandle();
	await tile(page, 3).click();
	await expect(page.getByTestId('word-score')).toHaveText('5');
	await expect(page.getByTestId('multiplier')).toHaveText('1×');
	await expect(page.locator('.connections line')).toHaveCount(2);
	expect(await firstLink!.evaluate((node) => node.isConnected)).toBe(true);
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('total')).toHaveText('5');
	await expect(page.getByRole('img', { name: 'Game total: 5', exact: true })).toBeVisible();
	await expect(page.locator('.award-points')).toHaveText('+5');
	await expect(page.locator('.connections line')).toHaveCount(0);
	await expect(page.getByTestId('word-score')).toHaveText('0');
});

test('reduced motion keeps scores immediate and responds to preference changes', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await setup(page);
	await play(page, [0, 1, 2, 3]);
	await expect(page.getByTestId('total')).toHaveText('12');
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.evaluate(() => {
		document.querySelector<HTMLButtonElement>('[data-tile="0"]')!.click();
	});
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(page.getByTestId('word-score')).toHaveText('3');
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
