# Papyrus

A minimal Svelte word game: link adjacent letters, submit English words, and score as much as possible in ten moves.

## Development

```sh
npm install
npm run dev
```

## Rules

- Use the mouse, touch dragging, or arrow keys and Space to select letters. Enter or Submit submits a word.
- All eight neighboring tiles are connected. Selecting an already selected tile removes it and all following tiles.
- Words must contain 2–16 letters and cannot repeat within a round. Rejected submissions do not consume moves.
- Letter values use standard English Scrabble scores. New letters come from a finite pool based on English usage, with soft duplicate and vowel balancing against the board.
- Length multipliers: 1–3 letters = 1×, 4–6 = 2×, 7–8 = 4×, 9–16 = 10×.
- Accepted words add letter score × multiplier to the total and replace their tiles.
- Ghost letters have clear backgrounds, score 0, and let the entire word be played without spending a move. They are replaced as usual, and the word cannot be repeated.
- Double letters have double outlines and count their printed points twice during scoring.
- Multiplier letters show ×1–×5 instead of points. They add that value to the word-length multiplier and contribute no base points; multiple bonuses add together.
- Each new tile has a 6% ghost, 10% double, 10% multiplier, and 74% ordinary chance. Multiplier values have respective chances of 60%, 25%, 10%, 4%, and 1%.
- After ten moves have been spent, the final score and restart button appear. The high score persists in localStorage when available.

The English dictionary is bundled locally. Source and license: [static/dictionary](static/dictionary/README.md).

## Motion

Tiles deal in and spring into selection, connections draw one segment at a time, and both meters flow with gently moving liquid edges. Multipliers pop at thresholds; accepted words show their score calculation while the total counts up. Motion takes its rhythm from Balatro while retaining the paper-and-sage palette.

Selection and scoring update immediately. Tile faces animate inside fixed hit areas, existing connections stay mounted during backtracking, and number tweens can be interrupted without losing points. The system follows `prefers-reduced-motion`, including changes made during a game.

## Verification

```sh
npm run check
npm run lint
npm run test:unit -- --run
npx playwright install chromium
npx playwright test
npm run build
```
