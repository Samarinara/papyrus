<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import AnimatedNumber from '$lib/AnimatedNumber.svelte';
	import {
		createBoard,
		DAILY_GAMES_KEY,
		dailyDateKey,
		LetterDealer,
		SeededRandom,
		type Tile,
		tilePoints,
		tileLabel,
		scoringSteps,
		wordMultiplierFor,
		moveCostFor,
		multiplierFor,
		replaceLetters,
		rejectionFor,
		scoreFor,
		selectTile,
		wordFor
	} from '$lib/game';

	let board = $state<Tile[]>([]);
	let path = $state<number[]>([]);
	let cursor = $state<number | null>(null);
	let moves = $state(10);
	let total = $state(0);
	let highScore = $state(0);
	let ready = $state(false);
	let message = $state('');
	let invalidTile = $state<number | null>(null);
	let scoring = $state(false);
	let grid = $state<HTMLDivElement>();
	let helpDialog = $state<HTMLDialogElement>();
	let helpOpen = $state(false);
	let tileVersions = $state(Array<number>(16).fill(0));
	let dealOrder = $state(Array.from({ length: 16 }, (_, index) => index));
	let award = $state<{ id: number; points: number; base: number; multiplier: number } | null>(null);
	let countedScore = $state(0);
	let countedMultiplier = $state(1);
	let scoringTile = $state<number | null>(null);
	let scoreTick = $state(0);
	let rejectionCount = $state(0);
	let movesBarScale = $state(1);
	let trackBarScale = $state(1);
	let puzzleDate = $state('');
	let dictionary = new Set<string>();
	let used = new SvelteSet<string>();
	const countedTiles = new SvelteSet<number>();
	const deselecting = new SvelteSet<number>();
	const deselectDelays = new SvelteMap<number, number>();
	const deselectTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();
	let random = new SeededRandom('uninitialized');
	let dealer = new LetterDealer(random.next);
	let pointer: number | null = null;
	let lastHit: number | null = null;
	let errorTimer: ReturnType<typeof setTimeout>;
	let movesBarTimer: ReturnType<typeof setTimeout>;
	let trackBarTimer: ReturnType<typeof setTimeout>;
	let scoreSequence = 0;
	const score = $derived(scoreFor(board, path));
	const multiplier = $derived(scoring ? countedMultiplier : multiplierFor(path.length));
	const freeWord = $derived(path.length > 0 && moveCostFor(board, path) === 0);
	const word = $derived(wordFor(board, path));
	const validWord = $derived(ready && word.length >= 2 && dictionary.has(word.toLowerCase()));
	const wordStatus = $derived(
		!ready || !word ? '' : validWord ? 'Valid Word' : 'Not In Dictionary'
	);

	function openHelp() {
		helpDialog?.showModal();
		helpOpen = true;
	}
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

	type DailyGame = {
		board: Tile[];
		path: number[];
		moves: number;
		total: number;
		used: string[];
		randomState: number;
		remaining: Record<string, number>;
		completed: boolean;
	};
	type DailyArchive = { version: 1; days: Record<string, DailyGame> };
	let archive: DailyArchive = { version: 1, days: {} };

	function isSavedGame(value: unknown): value is DailyGame {
		if (!value || typeof value !== 'object') return false;
		const game = value as Partial<DailyGame>;
		return (
			Array.isArray(game.board) &&
			game.board.length === 16 &&
			Array.isArray(game.path) &&
			Number.isInteger(game.moves) &&
			game.moves! >= 0 &&
			game.moves! <= 10 &&
			Number.isSafeInteger(game.total) &&
			game.total! >= 0 &&
			Array.isArray(game.used) &&
			Number.isInteger(game.randomState) &&
			!!game.remaining &&
			typeof game.remaining === 'object'
		);
	}

	function persistDaily(next: Partial<Pick<DailyGame, 'board' | 'path' | 'moves' | 'total'>> = {}) {
		const savedBoard = next.board ?? board;
		const savedPath = next.path ?? path;
		const savedMoves = next.moves ?? moves;
		const savedTotal = next.total ?? total;
		if (!puzzleDate || savedBoard.length !== 16) return;
		archive.days[puzzleDate] = {
			board: savedBoard.map((tile) => ({ ...tile })),
			path: [...savedPath],
			moves: savedMoves,
			total: savedTotal,
			used: [...used],
			randomState: random.state,
			remaining: dealer.snapshot(),
			completed: savedMoves === 0
		};
		try {
			localStorage.setItem(DAILY_GAMES_KEY, JSON.stringify(archive));
		} catch {
			/* Storage may be unavailable; the current session still works. */
		}
	}

	function initializeDaily() {
		puzzleDate = dailyDateKey();
		try {
			const stored = JSON.parse(localStorage.getItem(DAILY_GAMES_KEY) ?? 'null') as unknown;
			if (
				stored &&
				typeof stored === 'object' &&
				(stored as DailyArchive).version === 1 &&
				(stored as DailyArchive).days &&
				typeof (stored as DailyArchive).days === 'object'
			) {
				archive = stored as DailyArchive;
			}
		} catch {
			archive = { version: 1, days: {} };
		}

		const saved = archive.days[puzzleDate];
		if (isSavedGame(saved)) {
			random = new SeededRandom(saved.randomState);
			dealer = new LetterDealer(random.next, saved.remaining);
			board = saved.board.map((tile) => ({ ...tile }));
			path = [...saved.path];
			moves = saved.moves;
			total = saved.total;
			used = new SvelteSet(saved.used);
		} else {
			random = new SeededRandom(puzzleDate);
			dealer = new LetterDealer(random.next);
			board = createBoard(dealer);
			persistDaily();
		}
		highScore = Math.max(
			0,
			...Object.values(archive.days)
				.filter(isSavedGame)
				.map((game) => game.total)
		);
	}

	onMount(() => {
		initializeDaily();
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
			scoreSequence += 1;
			controller.abort();
			clearTimeout(errorTimer);
			clearTimeout(movesBarTimer);
			clearTimeout(trackBarTimer);
			for (const timer of deselectTimers.values()) clearTimeout(timer);
		};
	});

	const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const pause = (duration: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, reducedMotion() ? 0 : duration));

	function cascadeDeselect(indices: number[]) {
		const reduced = reducedMotion();
		for (const [order, tileIndex] of indices.entries()) {
			const delay = reduced ? 0 : order * 45;
			deselecting.add(tileIndex);
			deselectDelays.set(tileIndex, delay);
			clearTimeout(deselectTimers.get(tileIndex));
			const timer = setTimeout(
				() => {
					deselecting.delete(tileIndex);
					deselectDelays.delete(tileIndex);
					deselectTimers.delete(tileIndex);
				},
				reduced ? 0 : delay + 280
			);
			deselectTimers.set(tileIndex, timer);
		}
		return reduced || indices.length === 0 ? 0 : (indices.length - 1) * 45 + 300;
	}

	function select(index: number) {
		if (!ready || moves === 0 || scoring) return;
		cursor = index;
		const next = selectTile(path, index);
		if (next === null) {
			invalidTile = index;
			clearTimeout(errorTimer);
			errorTimer = setTimeout(() => (invalidTile = null), 240);
			return;
		}
		if (deselecting.has(index)) {
			deselecting.delete(index);
			deselectDelays.delete(index);
			clearTimeout(deselectTimers.get(index));
			deselectTimers.delete(index);
		}
		cascadeDeselect(path.filter((selectedIndex) => !next.includes(selectedIndex)));
		path = next;
		persistDaily();
		pulseBar('track');
		message = '';
	}

	async function submit() {
		if (!ready || moves === 0 || scoring) return;
		const rejection = rejectionFor(word, dictionary, used);
		if (rejection) {
			message = rejection;
			rejectionCount += 1;
			return;
		}
		used.add(word.toLowerCase());
		scoring = true;
		const submittedPath = [...path];
		const replacements = replaceLetters(board, submittedPath, dealer);
		const run = ++scoreSequence;
		const baseScore = score;
		const submittedMultiplier = wordMultiplierFor(board, submittedPath);
		const moveCost = moveCostFor(board, submittedPath);
		// Commit the accepted move before its animation. Closing or reloading mid-count
		// resumes after the move instead of allowing it to be replayed.
		persistDaily({
			board: replacements,
			path: [],
			moves: moves - moveCost,
			total: total + baseScore * submittedMultiplier
		});
		countedMultiplier = multiplierFor(submittedPath.length);
		const awardId = (award?.id ?? 0) + 1;
		// Give every letter a readable beat without making exceptionally long words drag.
		const beat = submittedPath.length >= 9 ? 250 : 340;
		award = null;
		countedScore = 0;
		countedTiles.clear();
		message = '';
		await pause(180);

		for (const step of scoringSteps(board, submittedPath)) {
			const tileIndex = step.index;
			if (run !== scoreSequence) return;
			scoringTile = tileIndex;
			countedTiles.add(tileIndex);
			countedScore += step.points;
			countedMultiplier += step.multiplier;
			scoreTick += 1;
			await pause(beat);
		}
		if (run !== scoreSequence) return;
		scoringTile = null;
		await pause(260);
		if (run !== scoreSequence) return;
		award = {
			id: awardId,
			points: baseScore * submittedMultiplier,
			base: baseScore,
			multiplier: submittedMultiplier
		};
		total += award.points;
		await pause(900);
		if (run !== scoreSequence) return;
		path = [];
		await pause(cascadeDeselect(submittedPath));
		if (run !== scoreSequence) return;
		dealOrder = board.map((_, index) => Math.max(0, submittedPath.indexOf(index)));
		tileVersions = tileVersions.map(
			(version, index) => version + Number(submittedPath.includes(index))
		);
		board = replacements;
		moves -= moveCost;
		if (moveCost) pulseBar('moves');
		pulseBar('track');
		if (total > highScore) highScore = total;
		countedScore = 0;
		countedTiles.clear();
		scoring = false;
		persistDaily();
	}

	function keydown(event: KeyboardEvent) {
		if (
			helpOpen ||
			moves === 0 ||
			!ready ||
			scoring ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		)
			return;
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
	<title>Papyrus Daily</title>
	<meta
		name="description"
		content="A daily letter-linking word game. Ten moves to make your highest score."
	/>
</svelte:head>

<svelte:window onkeydown={keydown} onpointerup={endDrag} onpointercancel={endDrag} />

<main class="game" aria-label="Papyrus word game">
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
		<header class="daily-header">
			<strong>Papyrus Daily</strong>
			<time datetime={puzzleDate}>{puzzleDate}</time>
		</header>

		<div class="play-area">
			<div class="board-column">
				<div class="word-status" aria-live="polite" aria-atomic="true">
					{#key wordStatus}
						<span class:valid={validWord}>{wordStatus}</span>
					{/key}
				</div>
				<div
					class="grid"
					bind:this={grid}
					role="group"
					aria-label="Letter grid"
					onpointermove={pointermove}
					onlostpointercapture={endDrag}
				>
					{#each board as tile, index (index)}
						<button
							class="tile"
							class:ghost={tile.type === 'ghost'}
							class:double={tile.type === 'double'}
							data-type={tile.type}
							class:selected={path.includes(index)}
							class:deselecting={deselecting.has(index)}
							class:counting={scoringTile === index}
							class:counted={countedTiles.has(index)}
							class:highlighted={cursor === index}
							class:invalid={invalidTile === index}
							style:--deselect-delay={`${deselectDelays.get(index) ?? 0}ms`}
							style:--tilt={`${(((index * 7) % 5) - 2) * 0.7}deg`}
							style:--deal-delay={`${dealOrder[index] * 14}ms`}
							data-tile={index}
							aria-label={`${tileLabel(tile)}, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`}
							aria-pressed={path.includes(index)}
							disabled={!ready || scoring}
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
									<span class="letter">{tile.letter}</span>
									<span class="letter-score"
										>{tile.type === 'multiplier' ? `×${tile.multiplier}` : tilePoints(tile)}</span
									>
									{#if scoringTile === index}
										{#key scoreTick}
											<span class="score-tick" aria-hidden="true"
												>+{tile.type === 'multiplier'
													? `${tile.multiplier}×`
													: tilePoints(tile)}</span
											>
										{/key}
									{/if}
								</span>
							{/key}
						</button>
					{/each}
					<svg class="connections" viewBox="0 0 400 400" aria-hidden="true">
						{#each connections as { from, to } (`${from}-${to}`)}
							<line
								class:counted-link={countedTiles.has(to)}
								class:counting-link={scoringTile === to}
								x1={(from % 4) * 100 + 50}
								y1={Math.floor(from / 4) * 100 + 50}
								x2={(to % 4) * 100 + 50}
								y2={Math.floor(to / 4) * 100 + 50}
								pathLength="1"
							/>
						{/each}
					</svg>
				</div>
				<div class="board-actions">
					<button
						class="submit"
						class:primed={path.length >= 2}
						onclick={submit}
						disabled={!ready || scoring}
						>{scoring ? 'Counting…' : ready ? 'Submit' : 'Loading…'}</button
					>
					<button
						class="help-button"
						aria-label="How to play"
						aria-haspopup="dialog"
						onclick={openHelp}>?</button
					>
				</div>
				<p class="free-word">{freeWord ? 'Ghost word · no move used' : ''}</p>
			</div>

			<div class:scoring class="scoreboard" aria-label="Scoreboard">
				<div class="score-columns">
					<div class="score-stat">
						<span class="score-label" aria-hidden="true">Word</span>
						<span aria-label={`Submitted word score: ${countedScore}`} data-testid="word-score"
							><AnimatedNumber
								value={countedScore}
								label={`Submitted word score: ${countedScore}`}
								strong
							/></span
						>
					</div>
					<div class="score-stat">
						<span class="score-label" aria-hidden="true">Multiplier</span>
						<span aria-label={`Multiplier: ${multiplier}`} data-testid="multiplier"
							><AnimatedNumber
								value={multiplier}
								suffix="×"
								label={`Multiplier: ${multiplier}`}
								strong
							/></span
						>
					</div>
				</div>
				<div class="total-stat">
					<div class="total-label" aria-hidden="true">Total</div>
					<div class="total" aria-label={`Game total: ${total}`} data-testid="total">
						<AnimatedNumber value={total} label={`Game total: ${total}`} strong />
					</div>
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
			<p class="daily-label">{puzzleDate} · Daily complete</p>
			<div class="final-score" aria-label={`Final score: ${total}`}>
				<AnimatedNumber value={total} label={`Final score: ${total}`} strong />
			</div>
			<p class="high-score">High score: {highScore}</p>
			<p class="tomorrow">Your next puzzle arrives tomorrow.</p>
		</div>
	{/if}
</main>

<dialog
	class="help-dialog"
	bind:this={helpDialog}
	onclose={() => (helpOpen = false)}
	aria-labelledby="help-title"
>
	<div class="help-heading">
		<h1 id="help-title">How to play</h1>
		<button class="help-close" aria-label="Close help" onclick={() => helpDialog?.close()}>×</button
		>
	</div>
	<p>
		Make words, earn points, and beat your high score in ten moves. There is one puzzle per day.
	</p>
	<h2>Connect letters</h2>
	<p>
		Tap or drag through neighboring tiles, including diagonals, to spell a word of at least two
		letters. Tap a selected tile to remove it and the letters after it, then press Submit when
		you’re ready. Each word can only be played once.
	</p>
	<h2>Build your score</h2>
	<p>
		Letter points are added together and multiplied by your word bonus: 2× for 4–6 letters, 4× for
		7–8, and 10× for 9 or more. Used tiles are replaced after each accepted word.
	</p>
	<ul>
		<li>
			<strong>Ghost (dashed outline):</strong> scores no points and makes the entire word cost no move.
		</li>
		<li><strong>Double outline:</strong> counts that letter’s points twice.</li>
		<li>
			<strong>×1–×5 tiles:</strong> add to your word multiplier instead of scoring letter points.
		</li>
	</ul>
	<p class="help-keyboard">
		Keyboard: arrow keys move between tiles, Space selects, and Enter submits. Escape closes this
		guide.
	</p>
</dialog>
