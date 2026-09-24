// Copies the Stockfish WASM build (lite, single-threaded) into public/ so the
// browser can load it as a Web Worker. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";

const src = new URL("../node_modules/stockfish/bin/", import.meta.url);
const dest = new URL("../public/engine/", import.meta.url);

mkdirSync(dest, { recursive: true });
for (const file of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
  copyFileSync(new URL(file, src), new URL(file, dest));
}
console.log("Stockfish engine copied to public/engine/");
