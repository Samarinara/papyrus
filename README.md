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
- Letter values and random letter frequencies use the standard English Scrabble distribution, without blanks.
- Length multipliers: 1–3 letters = 1×, 4–6 = 2×, 7–8 = 4×, 9–16 = 10×.
- Accepted words add letter score × multiplier to the total and replace their tiles.
- After ten accepted words, the final score and restart button appear. The high score persists in localStorage when available.

The English dictionary is bundled locally. Source and license: [static/dictionary](static/dictionary/README.md).

## Verification

```sh
npm run check
npm run lint
npm run test:unit -- --run
npx playwright install chromium
npx playwright test
npm run build
```
