// Deterministic tests for the forward-looking tactical layer. Run with `npm test`.
// They use the real Stockfish engine (depth-limited, cleared hash => reproducible) and
// never call an LLM.
import { after as afterAll, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { NodeEngine } from "./testing/nodeEngine";
import { detectCandidates, extendLine, findTacticalConsequence } from "./analyze";
import { sideLine } from "./describe";
import { discoveredAttack, discoveredCheck, removeDefender } from "./custom";
import { playLine } from "./board";
import { libraryCandidates } from "./library";
import { formatEval, parseUci } from "../chess-utils";

const engine = new NodeEngine();
afterAll(() => engine.close());

/** Runs the full pipeline for a learner move given as SAN. */
async function consequence(fen: string, san: string) {
  const move = new Chess(fen).move(san);
  const baseline = await engine.analyse(fen, { depth: 14 });
  const facts = await findTacticalConsequence({
    engine,
    beforeFen: fen,
    learnerMove: { from: move.from, to: move.to, promotion: move.promotion },
    baseline,
  });
  return { facts, baseline };
}

const at = (facts: { targets: { piece: string; square: string }[] } | null) =>
  facts?.targets.map((t) => `${t.piece}@${t.square}`);

describe("forward-looking tactical analysis", () => {
  // 1 ------------------------------------------------------------------------------------------
  it("knight fork: Qd7 allows Ne5 forking queen and rook", async () => {
    const fen = "5rk1/pp2qppp/2r5/8/8/3P1N2/PP3PPP/3QR1K1 b - - 0 1";
    const { facts } = await consequence(fen, "Qd7");
    assert.ok(facts, "expected a tactical consequence");
    assert.equal(facts.learnerMove, "Qd7");
    assert.equal(facts.opponentMove, "Ne5");
    assert.equal(facts.motif, "fork");
    assert.deepEqual(facts.attacker, { piece: "knight", color: "white", square: "e5" });
    assert.deepEqual(new Set(at(facts)), new Set(["queen@d7", "rook@c6"]));
    assert.equal(facts.engineVerified, true);
    assert.equal(facts.engineRank, 1);
    assert.ok(facts.materialGain >= 2);
    assert.ok(facts.centipawnLoss >= 100);
    // The knight fork is a consequence of Qd7, not something already on the board.
    assert.equal(facts.relation, "created_by_move");
  });

  // 2 ------------------------------------------------------------------------------------------
  it("no tactic: h5 is strategically inferior but nothing concrete is claimed", async () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const played = new Chess(fen);
    played.move("h5");
    const baseline = await engine.analyse(fen);
    const afterMove = await engine.analyse(played.fen(), { multiPv: 3 });
    const loss = baseline.cp + afterMove.cp;
    assert.ok(loss >= 40, `h5 should be objectively inferior (loss ${loss}cp)`);

    const { facts } = await consequence(fen, "h5");
    assert.equal(facts, null);
  });

  // 3 ------------------------------------------------------------------------------------------
  it("false-positive guard: geometric fork whose knight is captured is not reported", async () => {
    // Pawn on d6 covers e5: Ne5 would "fork" Qd7 and Rc6 but simply loses the knight.
    const fen = "5rk1/pp2qppp/2rp4/8/8/3P1N2/PP3PPP/3QR1K1 b - - 0 1";
    const { facts } = await consequence(fen, "Qd7");
    assert.equal(facts, null);

    // Force the losing line straight into the detectors: the guard must still reject any fork.
    const played = new Chess(fen);
    played.move("Qd7");
    const forced = ["f3e5", "d6e5"];
    const line = playLine(played.fen(), forced);
    assert.equal(line[1].captured, "n", "precondition: the knight is captured immediately");
    const survivors = detectCandidates({
      afterFen: played.fen(),
      line,
      engineLine: forced,
      learnerColor: "b",
    });
    assert.equal(survivors.filter((c) => c.motif === "fork").length, 0);
  });

  it("false-positive guard: library 'fork' on Nxf7 Kxf7 is rejected (king takes the knight)", async () => {
    // Fried Liver position, learner plays h6: the raw library labels Nxf7 Kxf7 a fork.
    const fen = "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5";
    const played = new Chess(fen);
    played.move("h6");
    const raw = libraryCandidates({ afterFen: played.fen(), line: ["g5f7", "e8f7", "d5c6", "f7e8"] });
    assert.ok(raw.some((c) => c.motif === "fork"), "precondition: the raw library does call it a fork");

    // ...but the guard removes it, because the king simply captures the knight.
    const forced = ["g5f7", "e8f7", "d5c6", "f7e8"];
    const survivors = detectCandidates({
      afterFen: played.fen(),
      line: playLine(played.fen(), forced),
      engineLine: forced,
      learnerColor: "b",
    });
    assert.equal(survivors.filter((c) => c.motif === "fork").length, 0);

    const { facts } = await consequence(fen, "h6");
    assert.notEqual(facts?.motif, "fork");
  });

  it("extends a truncated engine line so material can be judged", async () => {
    const fen = "5rk1/pp2qppp/2r5/8/8/3P1N2/PP3PPP/3QR1K1 b - - 0 1";
    const played = new Chess(fen);
    played.move("Qd7");
    const longer = await extendLine(engine, played.fen(), ["f3e5", "d7d5"]); // engine gave only 2 plies
    assert.ok(playLine(played.fen(), longer).length >= 6, "line was extended to at least 6 plies");
    assert.deepEqual(longer.slice(0, 2), ["f3e5", "d7d5"], "the original moves are kept");
  });

  // 4 ------------------------------------------------------------------------------------------
  it("pin: Re7 allows Bg5 pinning the rook to the queen", async () => {
    const fen = "2bqr1k1/pp4p1/8/8/3P4/5N2/PPP2PPP/2BQ2K1 b - - 0 1";
    const { facts } = await consequence(fen, "Re7");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Bg5");
    assert.equal(facts.motif, "pin");
    assert.deepEqual(at(facts), ["rook@e7", "queen@d8"]); // pinned piece first, then what it shields
    assert.equal(facts.attacker.square, "g5");
    assert.equal(facts.engineVerified, true);
    assert.ok(facts.materialGain >= 2);
  });

  // 5 ------------------------------------------------------------------------------------------
  it("hanging piece: Bg4 leaves the bishop to Qxg4", async () => {
    const fen = "r1bq1rk1/pp3ppp/8/8/8/8/PPP2PPP/R2Q2K1 b - - 0 1";
    const { facts } = await consequence(fen, "Bg4");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Qxg4");
    assert.equal(facts.motif, "hanging_piece");
    assert.deepEqual(at(facts), ["bishop@g4"]);
    assert.equal(facts.engineVerified, true);
    assert.ok(facts.materialGain >= 3);
  });

  // extras -------------------------------------------------------------------------------------
  it("skewer: h6 allows Ra8+ winning the queen behind the king", async () => {
    const fen = "2kq4/1p3ppp/8/8/8/5N2/1PP2PPP/R5K1 b - - 0 1";
    const { facts } = await consequence(fen, "h6");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Ra8+");
    assert.equal(facts.motif, "skewer");
    assert.deepEqual(at(facts), ["king@c8", "queen@d8"]);
    // Ra8+ was already possible before h6, so h6 merely failed to prevent it.
    assert.equal(facts.relation, "already_present");
  });

  it("discovered check: Petrov trap 4...Nf6?? 5.Nc6+", async () => {
    const fen = "rnbqkb1r/pppp1ppp/8/4N3/4n3/8/PPPPQPPP/RNB1KB1R b KQkq - 1 4";
    const { facts } = await consequence(fen, "Nf6");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Nc6+");
    assert.equal(facts.motif, "discovered_check");
    assert.deepEqual(facts.revealedPiece, { piece: "queen", color: "white", square: "e2" });
    assert.ok(at(facts)?.includes("queen@d8"));
  });

  it("discovered attack: Bxf7+ uncovers the rook's attack on the queen", async () => {
    const fen = "r1bq2k1/pp3ppp/8/3B4/8/5N2/PPP2PPP/3R2K1 b - - 0 1";
    const { facts } = await consequence(fen, "h6");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Bxf7+");
    assert.equal(facts.motif, "discovered_attack");
    assert.deepEqual(facts.revealedPiece, { piece: "rook", color: "white", square: "d1" });
    assert.deepEqual(at(facts), ["queen@d8"]);
  });

  it("removing the defender: Bxc6 takes the knight guarding the bishop on e5", async () => {
    const fen = "2b3k1/pp1p1ppp/2n5/1B2b3/4P3/1P3N1P/P1P2PP1/2B3K1 b - - 0 1";
    const { facts } = await consequence(fen, "a6");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Bxc6");
    assert.equal(facts.motif, "remove_defender");
    assert.deepEqual(at(facts), ["knight@c6", "bishop@e5"]); // defender, then the piece it guarded
  });

  it("sacrifice: Fried Liver — Nxd5? allows Nxf7 (engine-approved)", async () => {
    const fen = "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5";
    const { facts } = await consequence(fen, "Nxd5");
    assert.ok(facts);
    assert.equal(facts.opponentMove, "Nxf7");
    assert.equal(facts.motif, "sacrifice");
    assert.equal(facts.engineRank, 1);
    // With no move at all White would not play Nxf7; Nxd5 is what makes it work.
    assert.equal(facts.relation, "created_by_move");
    assert.deepEqual(facts.followUp.slice(0, 2), ["Kxf7", "Qf3+"]);
    assert.equal(sideLine(facts), "White Nxf7, Black Kxf7, White Qf3+");
    assert.equal(facts.sacrificedPiece, "knight", "the knight is what White gives up");
    assert.ok(facts.materialGain < 0, "a sacrifice costs material along the line");
    assert.ok(facts.centipawnLoss >= 40);
  });

  it("the best move produces no tactical claim (Fried Liver: Na5)", async () => {
    const fen = "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5";
    const { facts, baseline } = await consequence(fen, "Na5");
    assert.equal(facts, null);
    assert.equal(baseline.bestMove, "c6a5");
  });
});

// Regressions found by running the pipeline over every legal move of the Fried Liver position.
describe("false positives found in the full-move audit", () => {
  const FL = "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5";

  it("a knight taken by a pawn that can be recaptured is NOT a 'hanging piece' (Rb8, dxc6 bxc6)", async () => {
    assert.equal((await consequence(FL, "Rb8")).facts, null);
  });

  it("but it IS hanging once the only recapture is gone (b6 removes the b7 pawn)", async () => {
    const { facts } = await consequence(FL, "b6");
    assert.equal(facts?.motif, "hanging_piece");
    assert.equal(facts?.opponentMove, "dxc6");
    assert.deepEqual(at(facts), ["knight@c6"]);
  });

  it("a genuinely loose piece is reported (Ba3, Nxa3)", async () => {
    const { facts } = await consequence(FL, "Ba3");
    assert.equal(facts?.motif, "hanging_piece");
    assert.equal(facts?.opponentMove, "Nxa3");
    assert.equal(facts?.engineRank, 1);
  });

  it("does not call a queen capture 'removing the defender' (Qxd5, Bxd5)", async () => {
    assert.equal((await consequence(FL, "Qxd5")).facts, null);
  });

  it("does not report a pin of a pawn (Nh5, Qxh5 is a hanging knight, not a pin)", async () => {
    const { facts } = await consequence(FL, "Nh5");
    assert.equal(facts?.motif, "hanging_piece");
    assert.deepEqual(at(facts), ["knight@h5"]);
  });

  it("does not call it a sacrifice when nothing is given up (Bg4, Nxf7 Qe7)", async () => {
    assert.equal((await consequence(FL, "Bg4")).facts, null);
  });

  it("does not report a discovered attack on a mere pawn (Qd7, dxc6 uncovers Bc4 on f7)", async () => {
    assert.equal((await consequence(FL, "Qd7")).facts, null);
  });

  it("acceptable moves produce no claim (Nd4, b5)", async () => {
    assert.equal((await consequence(FL, "Nd4")).facts, null);
    assert.equal((await consequence(FL, "b5")).facts, null);
  });
});

describe("custom detectors are conservative", () => {
  it("do not fire on quiet lines", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const line = playLine(fen, ["g8f6", "d2d3", "f8c5"].map((m) => m));
    const ctx = { line, learner: "b" as const };
    assert.equal(discoveredCheck(ctx), null);
    assert.equal(discoveredAttack(ctx), null);
    assert.equal(removeDefender(ctx), null);
  });
});

describe("chess utilities used by the pipeline", () => {
  it("formats evaluations from the learner's point of view", () => {
    assert.equal(formatEval(113, null), "+1.1");
    assert.equal(formatEval(-99, null), "−1.0");
    assert.equal(formatEval(3, null), "0.0");
    assert.equal(formatEval(1000, 3), "M3");
  });
  it("parses UCI including promotions", () => {
    assert.deepEqual(parseUci("e7e8q"), { from: "e7", to: "e8", promotion: "q" });
  });
});
