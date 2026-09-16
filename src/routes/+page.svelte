<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import AnimatedNumber from '$lib/AnimatedNumber.svelte';
	import {
		createBoard,
		HIGH_SCORE_KEY,
		LetterDealer,
		LETTER_SCORES,
		multiplierFor,
		replaceLetters,
		rejectionFor,
		scoreFor,
		selectTile,
		wordFor
	} from '$lib/game';

	let board = $state<string[]>([]);
	let path = $state<number[]>([]);
	let cursor = $state<number | null>(null);
	let moves = $state(10);
	let total = $state(0);
	let highScore = $state(0);
	let ready = $state(false);
	let message = $state('');
	let invalidTile = $state<number | null>(null);
	let grid = $state<HTMLDivElement>();
	let tileVersions = $state(Array<number>(16).fill(0));
	let dealOrder = $state(Array.from({ length: 16 }, (_, index) => index));
	let award = $state<{ id: number; points: number; base: number; multiplier: number } | null>(null);
	let rejectionCount = $state(0);
	let movesBarScale = $state(1);
	let trackBarScale = $state(1);
	let theme = $state<ThemeId>('storybook');
	let themeMenuOpen = $state(false);
	let dictionary = new Set<string>();
	let used = new SvelteSet<string>();
	let dealer = new LetterDealer();
	let pointer: number | null = null;
	let lastHit: number | null = null;
	let errorTimer: ReturnType<typeof setTimeout>;
	let movesBarTimer: ReturnType<typeof setTimeout>;
	let trackBarTimer: ReturnType<typeof setTimeout>;
	const THEME_KEY = 'papyrus.theme';
	const themes = [
		{
			id: 'storybook',
			name: 'Storybook',
			description: 'Cut paper, ink and warm, wobbly type',
			preview: ['P', 'A', 'P']
		},
		{
			id: 'candy',
			name: 'Candy Shop',
			description: 'Glossy sweets, sprinkles and sticker letters',
			preview: ['Y', 'U', 'M']
		},
		{
			id: 'arcade',
			name: 'Pixel Arcade',
			description: 'Chunky pixels, scanlines and electric combos',
			preview: ['1', 'U', 'P']
		},
		{
			id: 'cosmos',
			name: 'Cosmic Drift',
			description: 'Floating glass glyphs in a star field',
			preview: ['O', 'R', 'B']
		},
		{
			id: 'garden',
			name: 'Secret Garden',
			description: 'Pressed flowers, clay tokens and soft type',
			preview: ['B', 'L', 'M']
		}
	] as const;
	type ThemeId = (typeof themes)[number]['id'];
	const score = $derived(scoreFor(board, path));
	const multiplier = $derived(multiplierFor(path.length));
	const word = $derived(wordFor(board, path));
	const connections = $derived(path.slice(1).map((to, index) => ({ from: path[index], to })));

	function pulseBar(type: 'moves' | 'track') {
		const setScale =
			type === 'moves'
				? (value: number) => (movesBarScale = value)
				: (value: number) => (trackBarScale = value);
		const timer = type === 'moves' ? movesBarTimer : trackBarTimer;
		clearTimeout(timer);
		setScale(1.025);
		const nextTimer = setTimeout(() => setScale(1), 180);
		if (type === 'moves') movesBarTimer = nextTimer;
		else trackBarTimer = nextTimer;
	}

	onMount(() => {
		board = createBoard(dealer);
		try {
			const stored = Number(localStorage.getItem(HIGH_SCORE_KEY));
			if (Number.isSafeInteger(stored) && stored >= 0) highScore = stored;
			const storedTheme = localStorage.getItem(THEME_KEY);
			if (themes.some(({ id }) => id === storedTheme)) theme = storedTheme as ThemeId;
		} catch {
			/* Storage may be unavailable; the game still works. */
		}
		const controller = new AbortController();
		fetch(`${base}/dictionary/words.txt`, { signal: controller.signal })
			.then((response) => {
				if (!response.ok) throw new Error('Dictionary unavailable');
				return response.text();
			})
			.then((text) => {
				dictionary = new Set(text.trim().split(/\r?\n/));
				ready = true;
			})
			.catch(() => {
				if (!controller.signal.aborted)
					message = 'Could not load the dictionary. Refresh to retry.';
			});
		return () => {
			controller.abort();
			clearTimeout(errorTimer);
		};
	});

	function chooseTheme(nextTheme: ThemeId) {
		theme = nextTheme;
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			/* Keep the theme for this session when storage is unavailable. */
		}
	}

	function select(index: number) {
		if (!ready || moves === 0) return;
		cursor = index;
		const next = selectTile(path, index);
		if (next === null) {
			invalidTile = index;
			clearTimeout(errorTimer);
			errorTimer = setTimeout(() => (invalidTile = null), 240);
			return;
		}
		path = next;
		pulseBar('track');
		message = '';
	}

	function submit() {
		if (!ready || moves === 0) return;
		const rejection = rejectionFor(word, dictionary, used);
		if (rejection) {
			message = rejection;
			rejectionCount += 1;
			return;
		}
		used.add(word.toLowerCase());
		award = { id: (award?.id ?? 0) + 1, points: score * multiplier, base: score, multiplier };
		total += award.points;
		dealOrder = board.map((_, index) => Math.max(0, path.indexOf(index)));
		tileVersions = tileVersions.map((version, index) => version + Number(path.includes(index)));
		board = replaceLetters(board, path, dealer);
		path = [];
		moves -= 1;
		pulseBar('moves');
		pulseBar('track');
		message = '';
		if (total > highScore) {
			highScore = total;
			try {
				localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
			} catch {
				/* Keep the session high score. */
			}
		}
	}

	function restart() {
		award = null;
		invalidTile = null;
		clearTimeout(errorTimer);
		dealOrder = Array.from({ length: 16 }, (_, index) => index);
		tileVersions = tileVersions.map((version) => version + 1);
		dealer = new LetterDealer();
		board = createBoard(dealer);
		path = [];
		cursor = null;
		moves = 10;
		total = 0;
		used = new SvelteSet();
		message = '';
		pointer = null;
		lastHit = null;
	}

	function keydown(event: KeyboardEvent) {
		if (moves === 0 || !ready || event.altKey || event.ctrlKey || event.metaKey) return;
		if (
			event.target instanceof HTMLButtonElement &&
			!event.target.hasAttribute('data-tile') &&
			!event.key.startsWith('Arrow')
		)
			return;
		if (event.key.startsWith('Arrow')) {
			event.preventDefault();
			if (cursor === null) {
				cursor = 0;
				grid?.querySelector<HTMLButtonElement>(`[data-tile="0"]`)?.focus();
				return;
			}
			const row = Math.floor(cursor / 4),
				col = cursor % 4;
			if (event.key === 'ArrowLeft') cursor = row * 4 + Math.max(0, col - 1);
			if (event.key === 'ArrowRight') cursor = row * 4 + Math.min(3, col + 1);
			if (event.key === 'ArrowUp') cursor = Math.max(0, row - 1) * 4 + col;
			if (event.key === 'ArrowDown') cursor = Math.min(3, row + 1) * 4 + col;
			grid?.querySelector<HTMLButtonElement>(`[data-tile="${cursor}"]`)?.focus();
		} else if (event.key === ' ') {
			event.preventDefault();
			if (!event.repeat) select(cursor ?? 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (!event.repeat) submit();
		}
	}

	function pointerdown(event: PointerEvent, index: number) {
		if (event.button !== 0 || pointer !== null) return;
		event.preventDefault();
		// Capture on the grid, then hit-test so touch and mouse share the same drag behavior.
		grid?.setPointerCapture(event.pointerId);
		pointer = event.pointerId;
		lastHit = index;
		select(index);
	}
	function pointermove(event: PointerEvent) {
		if (pointer !== event.pointerId) return;
		const element = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest<HTMLButtonElement>('[data-tile]');
		if (!element) {
			lastHit = null;
			return;
		}
		const index = Number(element.dataset.tile);
		cursor = index;
		if (index !== lastHit) {
			lastHit = index;
			select(index);
		}
	}
	function endDrag(event: PointerEvent) {
		if (pointer !== event.pointerId) return;
		if (grid?.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
		pointer = null;
		lastHit = null;
	}
</script>

<svelte:head>
	<title>Papyrus</title>
	<meta
		name="description"
		content="A letter-linking word game. Ten moves to make your highest score."
	/>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && themeMenuOpen) {
			event.preventDefault();
			themeMenuOpen = false;
			return;
		}
		keydown(event);
	}}
	onpointerup={endDrag}
	onpointercancel={endDrag}
/>

<main class="game" data-theme={theme} aria-label="Papyrus word game">
	{#if moves > 0}
		<div
			class="moves"
			class:low={moves <= 3}
			role="meter"
			aria-label="Moves remaining"
			aria-valuemin="0"
			aria-valuemax="10"
			aria-valuenow={moves}
		>
			<div
				class="moves-fill bar-fill"
				style:width={`${moves * 10}%`}
				style:transform={`scaleX(${movesBarScale})`}
			></div>
			<span class="moves-count"><AnimatedNumber value={moves} /></span>
		</div>

		<div class="play-area">
			<div class="board-column">
				<div
					class="grid"
					bind:this={grid}
					role="group"
					aria-label="Letter grid"
					onpointermove={pointermove}
					onlostpointercapture={endDrag}
				>
					{#each board as letter, index (index)}
						<button
							class="tile"
							class:selected={path.includes(index)}
							class:highlighted={cursor === index}
							class:invalid={invalidTile === index}
							style:--tilt={`${(((index * 7) % 5) - 2) * 0.7}deg`}
							style:--deal-delay={`${dealOrder[index] * 14}ms`}
							data-tile={index}
							aria-label={`${letter}, ${LETTER_SCORES[letter]} points, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`}
							aria-pressed={path.includes(index)}
							disabled={!ready}
							onpointerdown={(event) => pointerdown(event, index)}
							onpointerenter={() => {
								cursor = index;
							}}
							onpointerleave={() => {
								if (pointer === null && cursor === index) cursor = null;
							}}
							onfocus={() => (cursor = index)}
							onclick={(event) => {
								if (event.detail === 0) select(index);
							}}
						>
							{#key tileVersions[index]}
								<span class="tile-face">
									<span class="letter">{letter}</span>
									<span class="letter-score">{LETTER_SCORES[letter]}</span>
								</span>
							{/key}
						</button>
					{/each}
					<svg class="connections" viewBox="0 0 400 400" aria-hidden="true">
						{#each connections as { from, to } (`${from}-${to}`)}
							<line
								x1={(from % 4) * 100 + 50}
								y1={Math.floor(from / 4) * 100 + 50}
								x2={(to % 4) * 100 + 50}
								y2={Math.floor(to / 4) * 100 + 50}
								pathLength="1"
							/>
						{/each}
					</svg>
				</div>
				<div class="game-actions">
					<button class="submit" class:primed={path.length >= 2} onclick={submit} disabled={!ready}
						>{ready ? 'Submit' : 'Loading…'}</button
					>
					<div class="theme-settings">
						<button
							class="settings-button"
							type="button"
							aria-label="Choose a visual theme"
							aria-expanded={themeMenuOpen}
							aria-controls="theme-picker"
							onclick={() => (themeMenuOpen = !themeMenuOpen)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" />
								<path
									d="M19.1 13.9a7.6 7.6 0 0 0 .05-3.57l2-1.5-2-3.45-2.48 1a7.7 7.7 0 0 0-3.1-1.8L13.25 2h-4l-.33 2.6a7.7 7.7 0 0 0-3.1 1.79l-2.47-1-2 3.45 2.03 1.54a7.6 7.6 0 0 0 0 3.55l-2.03 1.54 2 3.45 2.47-1a7.7 7.7 0 0 0 3.1 1.79l.33 2.6h4l.33-2.6a7.7 7.7 0 0 0 3.1-1.8l2.47 1 2-3.44-2.05-1.56Z"
								/>
							</svg>
						</button>

						{#if themeMenuOpen}
							<div
								id="theme-picker"
								class="theme-picker"
								role="dialog"
								aria-modal="false"
								aria-label="Visual themes"
							>
								<div class="theme-picker-heading">
									<div>
										<p class="theme-eyebrow">Make it yours</p>
										<h2>Choose a world</h2>
									</div>
									<button
										class="theme-close"
										type="button"
										aria-label="Close theme chooser"
										onclick={() => (themeMenuOpen = false)}>×</button
									>
								</div>
								<div class="theme-options">
									{#each themes as option (option.id)}
										<button
											type="button"
											class="theme-option"
											class:active={theme === option.id}
											data-preview-theme={option.id}
											aria-pressed={theme === option.id}
											onclick={() => chooseTheme(option.id)}
										>
											<span class="theme-preview" aria-hidden="true">
												{#each option.preview as letter, index (`${letter}-${index}`)}<span
														>{letter}</span
													>{/each}
											</span>
											<span class="theme-copy">
												<strong>{option.name}</strong>
												<small>{option.description}</small>
											</span>
											<span class="theme-check" aria-hidden="true">✓</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<div class="scoreboard" aria-label="Scoreboard">
				<div class="score-columns">
					<span aria-label={`Active word score: ${score}`} data-testid="word-score"
						><AnimatedNumber value={score} label={`Active word score: ${score}`} /></span
					>
					<span aria-label={`Multiplier: ${multiplier}`} data-testid="multiplier"
						><AnimatedNumber
							value={multiplier}
							suffix="×"
							label={`Multiplier: ${multiplier}`}
							strong
						/></span
					>
				</div>
				<div class="total" aria-label={`Game total: ${total}`} data-testid="total">
					<AnimatedNumber value={total} label={`Game total: ${total}`} strong />
				</div>
				{#if award}
					{#key award.id}
						<div class="score-award" aria-hidden="true">
							<span class="award-formula">{award.base} × {award.multiplier}</span>
							<span class="award-points">+{award.points}</span>
						</div>
					{/key}
				{/if}
			</div>
		</div>

		<div class="feedback" role="status">
			{#key rejectionCount}<p class:rejected={message !== ''}>{message}</p>{/key}
		</div>
		<span class="sr-only" aria-live="polite"
			>{word ? `${word}, ${path.length} letters` : 'No letters selected'}</span
		>
		<div
			class="letter-track"
			role="meter"
			aria-label="Selected letters"
			aria-valuemin="0"
			aria-valuemax="16"
			aria-valuenow={path.length}
			aria-valuetext={`${path.length} letters, ${multiplier} times multiplier`}
		>
			<div
				class="track-fill bar-fill"
				style:width={`${Math.min(path.length / 10, 1) * 100}%`}
				style:transform={`scaleX(${trackBarScale})`}
				aria-hidden="true"
			></div>
			{#each Array.from({ length: 10 }, (_, index) => index + 1) as length (length)}
				<div
					class="track-step"
					class:filled={path.length >= length}
					class:milestone={[4, 7, 9].includes(length)}
				>
					<span>{multiplierFor(length)}×</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="end-screen" aria-label="Game over">
			<div class="final-score" aria-label={`Final score: ${total}`}>
				<AnimatedNumber value={total} label={`Final score: ${total}`} strong />
			</div>
			<p class="high-score">High score: {highScore}</p>
			<button class="submit" onclick={restart}>Restart</button>
		</div>
	{/if}
</main>
