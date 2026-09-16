<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import {
		createBoard,
		HIGH_SCORE_KEY,
		LETTER_SCORES,
		multiplierFor,
		randomLetter,
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
	let dictionary = new Set<string>();
	let used = new SvelteSet<string>();
	let pointer: number | null = null;
	let lastHit: number | null = null;
	let errorTimer: ReturnType<typeof setTimeout>;
	const score = $derived(scoreFor(board, path));
	const multiplier = $derived(multiplierFor(path.length));
	const word = $derived(wordFor(board, path));
	const points = $derived(
		path.map((index) => `${(index % 4) * 100 + 50},${Math.floor(index / 4) * 100 + 50}`).join(' ')
	);

	onMount(() => {
		board = createBoard();
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
			controller.abort();
			clearTimeout(errorTimer);
		};
	});

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
		message = '';
	}

	function submit() {
		if (!ready || moves === 0) return;
		const rejection = rejectionFor(word, dictionary, used);
		if (rejection) {
			message = rejection;
			return;
		}
		used.add(word.toLowerCase());
		total += score * multiplier;
		board = board.map((letter, index) => (path.includes(index) ? randomLetter() : letter));
		path = [];
		moves -= 1;
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
		board = createBoard();
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

<svelte:window onkeydown={keydown} onpointerup={endDrag} onpointercancel={endDrag} />

<main class="game" aria-label="Papyrus word game">
	{#if moves > 0}
		<div
			class="moves"
			role="meter"
			aria-label="Moves remaining"
			aria-valuemin="0"
			aria-valuemax="10"
			aria-valuenow={moves}
		>
			<div class="moves-fill" style:width={`${moves * 10}%`}></div>
			<span>{moves}</span>
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
							<span class="letter">{letter}</span>
							<span class="letter-score">{LETTER_SCORES[letter]}</span>
						</button>
					{/each}
					<svg class="connections" viewBox="0 0 400 400" aria-hidden="true">
						<polyline {points} />
					</svg>
				</div>
				<button class="submit" onclick={submit} disabled={!ready}
					>{ready ? 'Submit' : 'Loading…'}</button
				>
			</div>

			<div class="scoreboard" aria-label="Scoreboard">
				<div class="score-columns">
					<span aria-label={`Active word score: ${score}`} data-testid="word-score">{score}</span>
					<span aria-label={`Multiplier: ${multiplier}`} data-testid="multiplier"
						>{multiplier}×</span
					>
				</div>
				<div class="total" aria-label={`Game total: ${total}`} data-testid="total">{total}</div>
			</div>
		</div>

		<p class="feedback" role="status">{message}</p>
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
			{#each Array.from({ length: 10 }, (_, index) => index + 1) as length (length)}
				<div class:filled={path.length >= length}>{multiplierFor(length)}×</div>
			{/each}
		</div>
	{:else}
		<div class="end-screen" aria-label="Game over">
			<div class="final-score" aria-label={`Final score: ${total}`}>{total}</div>
			<p class="high-score">High score: {highScore}</p>
			<button class="submit" onclick={restart}>Restart</button>
		</div>
	{/if}
</main>
