# Chess Learning Lab

A small prototype of a tighter chess learning loop: **play → recognise the concept → understand the mistake → reinforce.**

1. **Play** – a predefined opening position. Make a move; the lab recognises the opening/concept you've reached and explains why it matters.
2. **Train** – a teaching position with a tempting mistake. Stockfish judges your move objectively; if it's inferior you see what you played, the better move, why it's weaker, and the principle behind it. Retry freely.
3. **Recap** – concepts encountered, the mistake worth revisiting, the principle to remember, one takeaway.

## Run it

```bash
npm install
cp .env.example .env.local   # add your MISTRAL_API_KEY
npm run dev
```

The app works without an API key — teaching text falls back to deterministic copy.

## How it's built

- **Rules & state:** `chess.js`. **Board:** `react-chessboard`.
- **Evaluation:** Stockfish 19 (WASM, lite single-threaded) in a Web Worker — [src/lib/engine.ts](src/lib/engine.ts). The engine binary is copied from `node_modules` to `public/engine/` by [scripts/copy-engine.mjs](scripts/copy-engine.mjs) before `dev`/`build`.
- **Language:** Mistral `ministral-3b-2512` writes the explanations only. It never picks or evaluates moves; it is handed facts computed by chess.js + Stockfish. The provider sits behind the `LLMProvider` interface in [src/lib/llm/](src/lib/llm/), called from a server route ([src/app/api/explain/route.ts](src/app/api/explain/route.ts)) so the key never reaches the browser.
- **Lesson content:** [src/content/curriculum.ts](src/content/curriculum.ts).

## Environment variables

| Variable | Required | Default |
| --- | --- | --- |
| `MISTRAL_API_KEY` | for LLM explanations | – |
| `MISTRAL_MODEL` | no | `ministral-3b-2512` |
| `LLM_PROVIDER` | no | `mistral` |
