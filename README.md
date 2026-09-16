# Papyrus

Papyrus is a ten-move word game about finding the best route through a 4×4 board. Draw a path through touching letters, submit the word, and decide whether to play it safe or hold out for a bigger multiplier.

Every accepted word changes the board. A short word can keep a useful cluster intact; a long word can clear the way to a much better score. When the tenth word is in, the board is done and the high-score chase starts again.

## How to play

- Drag through adjacent letters, including diagonals, to build a word. You can also use the arrow keys and Space.
- Submit a valid word with Enter or the Submit button. Words must be 2–16 letters long and cannot be repeated in the same round.
- Score the Scrabble value of your letters, multiplied by word length: 1× for 2–3 letters, 2× for 4–6, 4× for 7–8, and 10× for 9–16.
- Accepted words use up their tiles and refill them with new letters. Rejected submissions do not cost a move.

The game uses a broad local English word list, so uncommon and archaic words may be accepted. Your high score is saved in `localStorage` when the browser allows it.

## Development

```sh
npm install
npm run dev
```

## Project details

Papyrus is built with Svelte and designed for mouse, touch, and keyboard play. Tile selection, connections, score changes, and the board refill have immediate visual feedback, with support for `prefers-reduced-motion`.

The English dictionary is bundled locally. Gameplay does not call a third-party dictionary API. Source and license: [static/dictionary](static/dictionary/README.md).

## Verification

```sh
npm run check
npm run lint
npm run test:unit -- --run
npx playwright install chromium
npx playwright test
npm run build
```
