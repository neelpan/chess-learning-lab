// OPT-IN live check of the real model (ministral-3b-2512). Not part of `npm test`.
//   npm run test:live        (reads MISTRAL_API_KEY from .env.local; the key is never printed)
// It does not benchmark the model. It shows how faithfully it phrases verified facts, and that
// the route always returns something usable whatever the model does.
import { after as afterAll, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { getLLM } from "./llm";
import { POST } from "../app/api/explain/route";
import { NodeEngine } from "./tactics/testing/nodeEngine";
import { findTacticalConsequence } from "./tactics/analyze";
import { buildMistakeFacts } from "./mistake";
import { cleanLLMText, mistakePrompt, unsupportedClaims, type MistakeFacts } from "./teaching";
import { formatEval, uciToSan } from "./chess-utils";
import { TRAINING } from "@/content/curriculum";

const enabled = process.env.LIVE_LLM === "1" && !!process.env.MISTRAL_API_KEY;
const SAMPLES = 3;
const engine = new NodeEngine();
afterAll(() => engine.close());

async function factsFor(fen: string, san: string): Promise<MistakeFacts> {
  const played = new Chess(fen);
  const move = played.move(san);
  const baseline = await engine.analyse(fen, { depth: 14 });
  const after = await engine.analyse(played.fen(), { depth: 14, multiPv: 3 });
  const tactic = await findTacticalConsequence({ engine, beforeFen: fen, learnerMove: move, baseline, after });
  return buildMistakeFacts({
    beforeFen: fen,
    afterFen: played.fen(),
    playedSan: move.san,
    bestSan: uciToSan(fen, baseline.bestMove)!,
    playedEval: formatEval(-after.cp, after.mate === null ? null : -after.mate),
    bestEval: formatEval(baseline.cp, baseline.mate),
    replyPv: after.pv,
    bestPv: baseline.pv,
    tactic,
  });
}

const CASES = [
  { name: "A. knight fork (Qd7 → Ne5)", fen: "5rk1/pp2qppp/2r5/8/8/3P1N2/PP3PPP/3QR1K1 b - - 0 1", san: "Qd7", expectTactic: "fork" },
  { name: "B. Fried Liver (Nxd5 → Nxf7)", fen: TRAINING.fen, san: "Nxd5", expectTactic: "sacrifice" },
  { name: "C. inferior, no tactic (Rb8)", fen: TRAINING.fen, san: "Rb8", expectTactic: null },
  { name: "C2. inferior, no tactic (quiet h5)", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", san: "h5", expectTactic: null },
];

const words = (t: string) => t.trim().split(/\s+/).length;

describe("live ministral-3b-2512", { skip: !enabled && "set LIVE_LLM=1 and MISTRAL_API_KEY (see npm run test:live)" }, () => {
  it("uses the intended model", () => {
    const llm = getLLM();
    assert.ok(llm);
    assert.equal(llm.name, "mistral");
    assert.equal((process.env.MISTRAL_MODEL || "ministral-3b-2512"), "ministral-3b-2512");
  });

  for (const c of CASES) {
    it(c.name, async () => {
      const facts = await factsFor(c.fen, c.san);
      assert.equal(facts.tactic?.motif ?? null, c.expectTactic, "the deterministic layer found the expected tactic");
      const llm = getLLM()!;

      console.log(`\n=== ${c.name}\n    facts: played ${facts.playedSan}, best ${facts.bestSan}, reply line ${facts.refutationLine.join(" ")}${facts.tactic ? `, tactic ${facts.tactic.motif} ${facts.tactic.opponentMove}` : ""}`);
      let faithful = 0;
      for (let i = 1; i <= SAMPLES; i++) {
        const raw = cleanLLMText(await llm.complete({ messages: mistakePrompt(facts), maxTokens: 200 }));
        const problems = unsupportedClaims(raw, facts);
        if (!problems.length) faithful++;
        console.log(`  [raw ${i}] (${words(raw)} words) ${problems.length ? "REJECTED " + JSON.stringify(problems) : "faithful"}\n      ${raw.replace(/\n+/g, " ")}`);
      }
      console.log(`  raw faithfulness: ${faithful}/${SAMPLES}`);

      // Through the real route: whatever the model does, the learner gets usable text.
      const res = await POST(
        new Request("http://localhost/api/explain", { method: "POST", body: JSON.stringify({ kind: "mistake", facts }) }),
      );
      const json = await res.json();
      console.log(`  [route] source=${json.source} (${words(json.text)} words)\n      ${json.text}`);
      assert.equal(res.status, 200);
      assert.ok(json.text.length > 20 && words(json.text) <= 90, "route text is present and concise");
      assert.deepEqual(unsupportedClaims(json.text, facts), [], "whatever the route returns is faithful to the facts");
    });
  }
});
