<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
	let scoring = $state(false);
	let grid = $state<HTMLDivElement>();
	let tileVersions = $state(Array<number>(16).fill(0));
	let dealOrder = $state(Array.from({ length: 16 }, (_, index) => index));
	let award = $state<{ id: number; points: number; base: number; multiplier: number } | null>(null);
	let countedScore = $state(0);
	let scoringTile = $state<number | null>(null);
	let scoreTick = $state(0);
	let rejectionCount = $state(0);
	let movesBarScale = $state(1);
	let trackBarScale = $state(1);
	let dictionary = new Set<string>();
	let used = new SvelteSet<string>();
	const countedTiles = new SvelteSet<number>();
	const deselecting = new SvelteSet<number>();
	const deselectDelays = new SvelteMap<number, number>();
	const deselectTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();
	let dealer = new LetterDealer();
	let pointer: number | null = null;
	let lastHit: number | null = null;
	let errorTimer: ReturnType<typeof setTimeout>;
	let movesBarTimer: ReturnType<typeof setTimeout>;
	let trackBarTimer: ReturnType<typeof setTimeout>;
	let scoreSequence = 0;
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
		const submittedMultiplier = multiplier;
		const awardId = (award?.id ?? 0) + 1;
		// Give every letter a readable beat without making exceptionally long words drag.
		const beat = submittedPath.length >= 9 ? 250 : 340;
		award = null;
		countedScore = 0;
		countedTiles.clear();
		message = '';
		await pause(180);

		for (const tileIndex of submittedPath) {
			if (run !== scoreSequence) return;
			scoringTile = tileIndex;
			countedTiles.add(tileIndex);
			countedScore += LETTER_SCORES[board[tileIndex]];
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
		moves -= 1;
		pulseBar('moves');
		pulseBar('track');
		if (total > highScore) {
			highScore = total;
			try {
				localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
			} catch {
				/* Keep the session high score. */
			}
		}
		countedScore = 0;
		countedTiles.clear();
		scoring = false;
	}

	function restart() {
		scoreSequence += 1;
		award = null;
		countedScore = 0;
		scoringTile = null;
		countedTiles.clear();
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
		for (const timer of deselectTimers.values()) clearTimeout(timer);
		deselectTimers.clear();
		deselectDelays.clear();
		deselecting.clear();
		message = '';
		scoring = false;
		pointer = null;
		lastHit = null;
	}

	function keydown(event: KeyboardEvent) {
		if (moves === 0 || !ready || scoring || event.altKey || event.ctrlKey || event.metaKey) return;
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
							class:deselecting={deselecting.has(index)}
							class:counting={scoringTile === index}
							class:counted={countedTiles.has(index)}
							class:highlighted={cursor === index}
							class:invalid={invalidTile === index}
							style:--deselect-delay={`${deselectDelays.get(index) ?? 0}ms`}
							style:--tilt={`${(((index * 7) % 5) - 2) * 0.7}deg`}
							style:--deal-delay={`${dealOrder[index] * 14}ms`}
							data-tile={index}
							aria-label={`${letter}, ${LETTER_SCORES[letter]} points, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`}
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
									<span class="letter">{letter}</span>
									<span class="letter-score">{LETTER_SCORES[letter]}</span>
									{#if scoringTile === index}
										{#key scoreTick}
											<span class="score-tick" aria-hidden="true">+{LETTER_SCORES[letter]}</span>
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
				<button
					class="submit"
					class:primed={path.length >= 2}
					onclick={submit}
					disabled={!ready || scoring}
					>{scoring ? 'Counting…' : ready ? 'Submit' : 'Loading…'}</button
				>
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
				<div class="total-label" aria-hidden="true">Total</div>
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
