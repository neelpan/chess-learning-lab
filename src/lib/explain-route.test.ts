// The explanation route must always return usable text: no key, HTTP error, timeout,
// malformed response, or a model that strays from the facts all fall back to deterministic copy.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/explain/route";
import {
  cleanLLMText,
  explanationMatchesFacts,
  mistakeFallback,
  mistakePrompt,
  unsupportedClaims,
  type MistakeFacts,
} from "./teaching";
import type { TacticalFacts } from "./tactics/types";

const tactic: TacticalFacts = {
  learnerMove: "Qd7",
  opponentMove: "Ne5",
  opponentMoveUci: "f3e5",
  motif: "fork",
  relation: "created_by_move",
  attacker: { piece: "knight", color: "white", square: "e5" },
  targets: [
    { piece: "rook", color: "black", square: "c6" },
    { piece: "queen", color: "black", square: "d7" },
  ],
  followUp: ["Qd5", "Nxc6", "bxc6"],
  materialGain: 2,
  engineVerified: true,
  engineRank: 1,
  centipawnLoss: 549,
};

const facts: MistakeFacts = {
  playerColor: "Black",
  playedSan: "Qd7",
  bestSan: "Re6",
  playedEval: "−1.2",
  bestEval: "+4.3",
  refutationLine: ["Ne5", "Qd5", "Nxc6", "bxc6"],
  bestLine: ["Re6", "Rxe6", "Qxe6"],
  tactic,
};

const ORIGINAL_FETCH = globalThis.fetch;
const request = (body: unknown) =>
  new Request("http://localhost/api/explain", { method: "POST", body: JSON.stringify(body) });
const call = async (body: unknown) => {
  const res = await POST(request(body));
  return { status: res.status, json: await res.json() };
};
const mistral = (content: unknown, status = 200) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as typeof fetch;
};

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  console.error = () => {}; // silence expected error logs
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.MISTRAL_API_KEY;
});

describe("explain route fallbacks", () => {
  it("no API key: deterministic tactic explanation, LLM never called", async () => {
    delete process.env.MISTRAL_API_KEY;
    globalThis.fetch = (async () => assert.fail("must not call the LLM without a key")) as typeof fetch;
    const { status, json } = await call({ kind: "mistake", facts });
    assert.equal(status, 200);
    assert.equal(json.source, "fallback");
    assert.match(json.text, /Qd7/);
    assert.match(json.text, /Ne5/);
    assert.match(json.text, /This move allows a tactical sequence\. After Qd7, White can play Ne5/);
    assert.match(json.text, /knight fork/);
    assert.match(json.text, /queen on d7/);
    assert.match(json.text, /rook on c6/);
  });

  it("uses the LLM when its text sticks to the facts", async () => {
    mistral("After Qd7 I can play Ne5, attacking your queen on d7 and your rook on c6: a knight fork.");
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "llm");
    assert.match(json.text, /knight fork/);
  });

  it("rejects an LLM answer that invents a move", async () => {
    mistral("Qd7 is bad because Qh5 wins a pawn and Ne5 is strong.");
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "fallback");
  });

  it("rejects an LLM answer that invents a square", async () => {
    mistral("Ne5 attacks your queen on d7 and your rook on a1.");
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "fallback");
  });

  it("rejects an LLM answer that never names the tactical move", async () => {
    mistral("That move loses material because pieces got attacked.");
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "fallback");
  });

  it("HTTP error from Mistral: falls back", async () => {
    mistral("ignored", 500);
    const { status, json } = await call({ kind: "mistake", facts });
    assert.equal(status, 200);
    assert.equal(json.source, "fallback");
  });

  it("network failure / timeout: falls back", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    }) as typeof fetch;
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "fallback");
  });

  it("malformed Mistral payloads: fall back", async () => {
    for (const bad of ["", null, 42, [], [{ type: "image" }]]) {
      mistral(bad);
      const { json } = await call({ kind: "mistake", facts });
      assert.equal(json.source, "fallback", `payload ${JSON.stringify(bad)}`);
    }
    globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    assert.equal((await call({ kind: "mistake", facts })).json.source, "fallback");
  });

  it("without a tactic, keeps the original explanation path", async () => {
    delete process.env.MISTRAL_API_KEY;
    const { json } = await call({ kind: "mistake", facts: { ...facts, tactic: null } });
    assert.match(json.text, /This move is less accurate\. Stockfish prefers Re6/);
    assert.doesNotMatch(json.text, /fork|f7|pressure|attackers/i, "no tactic or scenario wording without a verified tactic");
  });

  it("rejects invalid or tampered tactic facts", async () => {
    for (const tampered of [
      { ...tactic, motif: "checkmate" },
      { ...tactic, engineVerified: false },
      { ...tactic, targets: [{ piece: "dragon", color: "black", square: "d7" }] },
      { ...tactic, attacker: { ...tactic.attacker, square: "z9" } },
      { ...tactic, followUp: Array(50).fill("Ne5") },
    ]) {
      const { status } = await call({ kind: "mistake", facts: { ...facts, tactic: tampered } });
      assert.equal(status, 400);
    }
  });

  it("an already-present threat is worded as one the move failed to address", async () => {
    delete process.env.MISTRAL_API_KEY;
    const { json } = await call({ kind: "mistake", facts: { ...facts, tactic: { ...tactic, relation: "already_present" } } });
    assert.match(json.text, /doesn't deal with a threat that was already there/);
  });

  it("recap requests still work and fall back", async () => {
    delete process.env.MISTRAL_API_KEY;
    const { json } = await call({ kind: "recap", facts: { concepts: ["Fork"], principle: "p", mistake: null } });
    assert.equal(json.source, "fallback");
    assert.ok(json.text.length > 10);
  });
});

describe("prompt and guard", () => {
  it("the tactic prompt carries the verified facts and forbids invention", () => {
    const [system, user] = mistakePrompt(facts);
    assert.match(system.content, /Do not change any move or square/);
    assert.match(system.content, /do not invent tactical motifs/i);
    assert.match(user.content, /"opponentMove":"Ne5"/);
    assert.match(user.content, /"motif":"fork"/);
    assert.match(user.content, /"engineVerified":true/);
    assert.match(user.content, /"square":"c6"/);
  });

  it("guard accepts faithful text and ignores ordinary words", () => {
    assert.ok(explanationMatchesFacts("Be careful: Ne5 forks your queen on d7 and rook on c6, a Bishop of trouble.", facts));
  });

  it("fallback text names only facts it was given", () => {
    assert.ok(explanationMatchesFacts(mistakeFallback(facts), facts));
  });
});

describe("validator: the model may not invent tactics, mate, or ramble", () => {
  const noTactic: MistakeFacts = { ...facts, tactic: null };

  it("rejects a named tactic when none was verified", () => {
    const problems = unsupportedClaims("After Qd7 your opponent plays Ne5, a fork.", noTactic);
    assert.deepEqual(problems, ["tactic not established: fork"]);
  });

  it("rejects a different tactic than the verified one", () => {
    const text = "After Qd7 your opponent plays Ne5, pinning your rook on c6.";
    assert.match(unsupportedClaims(text, facts).join(), /tactic not established: pinning/);
  });

  it("accepts the verified tactic's own name, in any inflection", () => {
    assert.deepEqual(unsupportedClaims("Ne5 forks your queen on d7 and rook on c6 — a knight fork.", facts), []);
  });

  it("rejects talk of checkmate", () => {
    assert.match(unsupportedClaims("Ne5 wins material and may lead to checkmate.", facts).join(), /not in facts: checkmate/);
  });

  it("rejects rambling answers", () => {
    const long = `After Qd7 your opponent can play Ne5 ${"and so on ".repeat(40)}`;
    assert.ok(unsupportedClaims(long, facts).includes("too long"));
  });

  it("rejects other named tactics that the summary never used", () => {
    for (const word of ["zugzwang", "overloaded", "back rank", "deflection", "discovered attack"]) {
      assert.ok(unsupportedClaims(`Ne5 fork with ${word}.`, facts).length > 0, word);
    }
  });

  it("strips markdown before validating and returning", async () => {
    assert.equal(cleanLLMText("After **Qd7**, `Ne5` is a __fork__."), "After Qd7, Ne5 is a fork.");
    mistral("After **Qd7** I can play **Ne5**, attacking your queen on d7 and your rook on c6 — a knight fork.");
    const { json } = await call({ kind: "mistake", facts });
    assert.equal(json.source, "llm");
    assert.doesNotMatch(json.text, /[*_`]/);
  });

  it("the prompt asks for a paraphrase of the verified summary and forbids additions", () => {
    const [system, user] = mistakePrompt(facts);
    assert.match(user.content, /Verified summary \(already correct\):\nThis move allows a tactical sequence/);
    assert.match(user.content, /Add nothing/);
    assert.match(user.content, /no talk of checkmate/);
    assert.match(user.content, /no bold, no asterisks/);
    assert.match(system.content, /only truth/i);
  });
});

describe("validator: sides and numbers (found with the real model)", () => {
  // Fried Liver facts: learner is Black; White plays Nxf7 and Qf3+, Black plays Nxd5 and Kxf7.
  const friedLiver: MistakeFacts = {
    playerColor: "Black",
    playedSan: "Nxd5",
    bestSan: "Na5",
    playedEval: "−1.0",
    bestEval: "0.0",
    refutationLine: ["Nxf7", "Kxf7", "Qf3+", "Ke6"],
    bestLine: ["Na5", "Bb5+", "c6"],
    tactic: {
      ...tactic,
      learnerMove: "Nxd5",
      opponentMove: "Nxf7",
      opponentMoveUci: "g5f7",
      motif: "sacrifice",
      attacker: { piece: "knight", color: "white", square: "f7" },
      targets: [{ piece: "pawn", color: "black", square: "f7" }],
      followUp: ["Kxf7", "Qf3+", "Ke6"],
      sacrificedPiece: "knight",
    },
  };

  it("labels each move with the side that plays it", async () => {
    const { moveSides } = await import("./teaching");
    const sides = moveSides(friedLiver);
    assert.deepEqual(new Set(sides.learner), new Set(["Nxd5", "Na5", "Kxf7", "c6", "Ke6"]));
    assert.deepEqual(new Set(sides.opponent), new Set(["Nxf7", "Qf3+", "Bb5+"]));
    const user = mistakePrompt(friedLiver)[1].content;
    assert.match(user, /"learnerMoves":\[/);
    assert.match(user, /"opponentMoves":\[/);
    assert.match(user, /Stockfish's line: White Nxf7, Black Kxf7, White Qf3\+/);
  });

  it("rejects the side swap the real model produced: 'After Kxf7, you can play Qf3+'", () => {
    const text = "After Nxd5, your opponent plays Nxf7. After Kxf7, you can play Qf3+, and White wins.";
    assert.match(unsupportedClaims(text, friedLiver).join(), /wrong side: Qf3 is your opponent's move/);
  });

  it("rejects 'you play Nxf7' but accepts the correct attribution", () => {
    assert.ok(unsupportedClaims("You play Nxd5 and then you play Nxf7.", friedLiver).some((p) => /Nxf7/.test(p)));
    assert.deepEqual(
      unsupportedClaims("After Nxd5, your opponent can play Nxf7. If you take with Kxf7, White continues with Qf3+.", friedLiver),
      [],
    );
  });

  it("rejects naming the wrong piece as the one given up (the real model said 'a pawn')", () => {
    const wrong = "After Nxd5, White plays Nxf7, giving up a pawn. Then Kxf7 and Qf3+.";
    assert.match(unsupportedClaims(wrong, friedLiver).join(), /wrong piece given up: pawn/);
    const right = "After Nxd5, White plays Nxf7, giving up its knight. Then Kxf7 and Qf3+.";
    assert.deepEqual(unsupportedClaims(right, friedLiver), []);
    // and with no verified sacrifice, any "giving up" claim is unsupported
    assert.ok(unsupportedClaims("Rb8 is giving up a pawn.", { ...facts, tactic: null }).length > 0);
  });

  it("rejects outcome claims that are not in the verified summary (the real model said 'Qf3+, winning a piece')", () => {
    const text = "After Nxd5, White plays Nxf7. Next, White plays Qf3+, winning a piece.";
    assert.match(unsupportedClaims(text, friedLiver).join(), /outcome not in facts: winning a piece/);
    assert.ok(unsupportedClaims("After Nxd5, White plays Nxf7 and you end up losing material.", friedLiver).length > 0);
    assert.ok(unsupportedClaims("Ne5 wins more material for White.", facts).length > 0);
  });

  it("rejects every outcome phrasing the real model produced that the facts do not state", () => {
    const invented = [
      "White then plays Qf3+, gaining a full point.",
      "This gives up a knight for a pawn. Next, White plays Qf3+, winning a piece.",
      "You lose your knight, but White's knight is captured next.",
      "If you play Re6 instead, you gain 5.5 points.",
      "That move is weaker because it loses more material.",
      "You played Nxd5 (losing 5.5 points).",
    ];
    for (const sentence of invented) {
      const text = `After Nxd5, White plays Nxf7. ${sentence}`;
      assert.ok(unsupportedClaims(text, friedLiver).some((p) => /outcome not in facts/.test(p)), sentence);
    }
  });

  it("accepts the material sentence the fallback itself contains", () => {
    const rb8: MistakeFacts = { ...facts, tactic: null, playedSan: "Rb8", bestSan: "Na5", refutationLine: ["dxc6", "Bc5"], materialLoss: 3 };
    assert.deepEqual(unsupportedClaims("After Rb8, its strongest reply is dxc6. In its main line you lose about 3 points of material.", rb8), []);
  });

  it("still accepts an outcome the verified summary itself states", () => {
    const hanging: MistakeFacts = {
      ...facts,
      playedSan: "Bg4",
      tactic: {
        ...tactic,
        learnerMove: "Bg4",
        opponentMove: "Qxg4",
        motif: "hanging_piece",
        attacker: { piece: "queen", color: "white", square: "g4" },
        targets: [{ piece: "bishop", color: "black", square: "g4" }],
        followUp: ["Qf6"],
      },
      refutationLine: ["Qxg4", "Qf6"],
      bestLine: ["Re6"],
    };
    assert.ok(mistakeFallback(hanging).includes("winning your bishop"));
    assert.deepEqual(unsupportedClaims("After Bg4, White plays Qxg4, winning your bishop on g4.", hanging), []);
  });

  it("the deterministic fallback always passes its own validator", () => {
    for (const f of [facts, { ...facts, tactic: null, materialLoss: 3 }]) {
      assert.deepEqual(unsupportedClaims(mistakeFallback(f), f), []);
    }
  });

  it("rejects your opponent playing your move", () => {
    assert.ok(unsupportedClaims("Your opponent replies with Kxf7 after Nxf7.", friedLiver).some((p) => /Kxf7/.test(p)));
  });

  it("rejects numbers that are not in the facts and piece counts (points ≠ pieces)", () => {
    const noTactic: MistakeFacts = { ...facts, tactic: null, materialLoss: 3 };
    assert.deepEqual(unsupportedClaims("Re6 is better; after Qd7 you lose about 3 points of material.", noTactic), []);
    assert.ok(unsupportedClaims("After Qd7 you lose three pieces.", noTactic).length > 0);
    assert.ok(unsupportedClaims("After Qd7 you lose 7 points of material.", noTactic).length > 0);
    assert.ok(unsupportedClaims("After Qd7 you lose about 3 pieces.", noTactic).some((p) => /pieces vs points/.test(p)));
  });

  it("rejects a signed score the facts never gave ('puts you on +1 point'), even with one target", () => {
    const text = "After Nxd5, White plays Nxf7. After Kxf7, Qf3+ puts you on +1 point.";
    assert.ok(unsupportedClaims(text, friedLiver).some((p) => /number not in facts: 1/.test(p)));
  });

  it("still allows 'two pieces' for a fork that really hits two pieces", () => {
    assert.deepEqual(
      unsupportedClaims("After Qd7, White plays Ne5, a fork that attacks two pieces: your rook on c6 and queen on d7.", facts),
      [],
    );
  });

  it("does not mistake move notation for numbers", () => {
    // Qd5 is Black's reply in this line, so it correctly belongs to "you".
    assert.deepEqual(
      unsupportedClaims("After Qd7 your opponent plays Ne5, a knight fork. If you play Qd5, they take with Nxc6.", facts),
      [],
    );
  });
});
