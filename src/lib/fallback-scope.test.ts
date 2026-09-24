// An inferior move with no verified tactic must be explained ONLY from facts established for that
// move. In particular it must never inherit the Training scenario's theme or principle.
import { after as afterAll, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { NodeEngine } from "./tactics/testing/nodeEngine";
import { findTacticalConsequence } from "./tactics/analyze";
import { buildMistakeFacts } from "./mistake";
import { mistakeFallback, mistakePrompt, type MistakeFacts } from "./teaching";
import { formatEval, uciToSan } from "./chess-utils";
import { TRAINING, principleAppliesTo } from "@/content/curriculum";

const engine = new NodeEngine();
afterAll(() => engine.close());

const FRIED_LIVER = TRAINING.fen;

/** The same pipeline the Train page runs for an inferior move. */
async function explain(fen: string, san: string) {
  const played = new Chess(fen);
  const move = played.move(san);
  const baseline = await engine.analyse(fen, { depth: 14 });
  const after = await engine.analyse(played.fen(), { depth: 14, multiPv: 3 });
  const tactic = await findTacticalConsequence({ engine, beforeFen: fen, learnerMove: move, baseline, after });
  const facts = buildMistakeFacts({
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
  return { facts, tactic, loss: baseline.cp + after.cp };
}

// Words that belong to the Fried Liver lesson, not to an arbitrary blunder.
const SCENARIO_WORDS = /f7|pressure|outnumber|attackers|defenders|weak square|Fried|tempo|threat before you grab/i;

/** Engine lines legitimately contain squares (e.g. "Nxf7"); only the prose is checked for lesson wording. */
const prose = (text: string) =>
  text.replace(/\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8]|O-O(?:-O)?)[+#]?/g, "");

describe("fallback for a move with no verified tactic", () => {
  const UNRELATED = ["Rb8", "Bd7", "Qe7", "e4", "g6", "h5", "Kd7", "Be6"];

  for (const san of UNRELATED) {
    it(`${san}: neutral wording, no scenario theme or principle, no invented motif`, async () => {
      const { facts, tactic, loss } = await explain(FRIED_LIVER, san);
      assert.ok(loss >= 40, `${san} must be objectively inferior for this test to mean anything`);
      assert.equal(tactic, null, "precondition: no verified tactic for this move");

      const text = mistakeFallback(facts);
      assert.match(text, /^This move is less accurate\. Stockfish prefers Na5/);
      assert.doesNotMatch(prose(text), SCENARIO_WORDS);
      assert.doesNotMatch(text, /fork|pin|skewer|sacrifice|discovered/i);

      // The same must hold for what the LLM would be shown.
      const prompt = mistakePrompt(facts).map((m) => m.content).join("\n");
      assert.doesNotMatch(prose(prompt), SCENARIO_WORDS);
      assert.match(prompt, /none was established/);

      // The lesson principle is not offered as the reason.
      assert.equal(principleAppliesTo(tactic), false);
    });
  }

  it("the mistake facts contain no scenario copy at all", async () => {
    const { facts } = await explain(FRIED_LIVER, "Rb8");
    assert.deepEqual(Object.keys(facts).sort().filter((k) => k === "theme" || k === "principle"), []);
  });

  it("reports concrete, engine-established consequences only (Rb8 hangs a knight to dxc6)", async () => {
    const { facts } = await explain(FRIED_LIVER, "Rb8");
    assert.equal(facts.refutationLine[0], "dxc6");
    assert.ok((facts.materialLoss ?? 0) >= 2, "the engine line does lose material");
    const text = mistakeFallback(facts);
    assert.match(text, /its strongest reply is dxc6/);
    assert.match(text, /you lose about \d points of material/);
  });

  it("works outside the Fried Liver scenario entirely", async () => {
    // Quiet Italian position: 3...h5 is inferior, with no concrete tactic.
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const { facts, tactic, loss } = await explain(fen, "h5");
    assert.ok(loss >= 40);
    assert.equal(tactic, null);
    const text = mistakeFallback(facts);
    assert.match(text, /^This move is less accurate\. Stockfish prefers /);
    assert.doesNotMatch(prose(text), SCENARIO_WORDS);
  });

  it("omits the material sentence when the engine line does not lose material", async () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const { facts } = await explain(fen, "h5");
    assert.equal(facts.materialLoss, undefined);
    assert.doesNotMatch(mistakeFallback(facts), /points of material/);
  });
});

describe("verified tactics", () => {
  it("Fried Liver Nxd5: explains the consequence first, with the lesson principle", async () => {
    const { facts, tactic } = await explain(FRIED_LIVER, "Nxd5");
    assert.ok(tactic);
    assert.equal(principleAppliesTo(tactic), true, "the tactic is on the scenario's weak square");
    const text = mistakeFallback(facts);
    assert.match(text, /^This move allows a tactical sequence\. After Nxd5, White can continue with Nxf7, giving up its knight at first/);
    assert.match(text, /Stockfish's line: White Nxf7, Black Kxf7, White Qf3\+, and it ends up better for White/);
    assert.doesNotMatch(text, /^Sacrifice|is a sacrifice/i, "consequence first, jargon secondary");
  });

  it("a tactic away from the weak square does not borrow the scenario principle (Ba3, Nxa3)", async () => {
    const { tactic } = await explain(FRIED_LIVER, "Ba3");
    assert.equal(tactic?.motif, "hanging_piece");
    assert.equal(principleAppliesTo(tactic), false);
  });

  it("knight fork explanation leads with the consequence", async () => {
    const fen = "5rk1/pp2qppp/2r5/8/8/3P1N2/PP3PPP/3QR1K1 b - - 0 1";
    const { facts, tactic } = await explain(fen, "Qd7");
    assert.equal(tactic?.motif, "fork");
    assert.match(
      mistakeFallback(facts),
      /^This move allows a tactical sequence\. After Qd7, White can play Ne5, attacking your rook on c6 and your queen on d7 at once — a knight fork\./,
    );
  });
});

// Type-level guard: the fixture below only compiles while MistakeFacts has no theme/principle.
const _noScenarioCopy: MistakeFacts = {
  playerColor: "Black",
  playedSan: "a6",
  bestSan: "Na5",
  playedEval: "−1.0",
  bestEval: "0.0",
  refutationLine: [],
  bestLine: [],
};
void _noScenarioCopy;
