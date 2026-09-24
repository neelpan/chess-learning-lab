import { TRAINING } from "@/content/curriculum";
import type { LLMMessage } from "./llm/types";
import { tacticExplanation } from "./tactics/describe";
import type { Motif, TacticalFacts } from "./tactics/types";

// Facts computed deterministically (chess.js + Stockfish) and handed to the LLM.
// The LLM only turns them into language — it never picks or evaluates moves.

// Deliberately contains no scenario copy (no "theme", no "principle"): an explanation may only
// use what was established about THIS move, so an unrelated blunder can never inherit lesson text.
export type MistakeFacts = {
  playerColor: string;
  playedSan: string;
  bestSan: string;
  /** Evaluations in pawns from the learner's point of view, e.g. "-1.0". */
  playedEval: string;
  bestEval: string;
  /** The opponent's strongest reply to the move played, in SAN, plus the line after it. */
  refutationLine: string[];
  bestLine: string[];
  /** Points of material the learner loses along Stockfish's line (only set when >= 2). */
  materialLoss?: number;
  /** Present only when a concrete tactic was found AND verified by Stockfish. */
  tactic?: TacticalFacts | null;
};

export type RecapFacts = {
  concepts: string[];
  principle: string;
  mistake: { playedSan: string; bestSan: string } | null;
};

const SYSTEM = `You are a warm, precise chess coach writing for an improving club player.
Rules:
- Use ONLY the facts provided. Do not invent moves, variations or evaluations, and never analyse the position yourself.
- Refer to moves exactly as written in the facts.
- Plain text only: no markdown, no lists, no headings, no emoji.
- Be concrete and brief. No preamble like "Great question".`;

/** Which side plays which move, so the model never has to guess who does what. */
export function moveSides(f: MistakeFacts): { learner: string[]; opponent: string[] } {
  const t = f.tactic;
  const learner = new Set<string>([f.playedSan, f.bestSan]);
  const opponent = new Set<string>();
  const alternate = (line: string[], firstIsOpponent: boolean) =>
    line.forEach((m, i) => ((i % 2 === 0) === firstIsOpponent ? opponent : learner).add(m));
  alternate(f.refutationLine, true);
  alternate(f.bestLine.slice(1), true);
  if (t) alternate([t.opponentMove, ...t.followUp], true);
  for (const m of learner) opponent.delete(m); // a move that both sides could play is ambiguous: leave it out
  for (const m of opponent) learner.delete(m);
  return { learner: [...learner], opponent: [...opponent] };
}

const REWRITE_RULES = `Rewrite the verified summary in simpler, friendlier words for a beginner (at most 55 words).
- Keep every move exactly as written, in standard notation (for example Ne5, not "the knight on e5" alone).
- Add nothing: no extra consequences, no other threats, no advice, no talk of checkmate or king safety.
- Do not name any tactic that the summary does not name.
- The learner is "you" and plays only the moves listed under learnerMoves. The opponent plays only the moves under opponentMoves. Never swap them.
- Material is counted in points, not pieces; do not restate numbers differently.
- Plain text only: no bold, no asterisks, no lists.`;

export function mistakePrompt(f: MistakeFacts): LLMMessage[] {
  if (f.tactic) return tacticPrompt(f, f.tactic);
  return [
    {
      role: "system",
      content: `${SYSTEM}
- The facts below come from a chess engine. Do not name any tactic, theme or principle: none was established.`,
    },
    {
      role: "user",
      content: `The learner plays ${f.playerColor}. learnerMoves: ${moveSides(f).learner.join(" ")}. opponentMoves: ${moveSides(f).opponent.join(" ") || "none"}.
Move they played: ${f.playedSan} (engine evaluation for them: ${f.playedEval}).
Better move: ${f.bestSan} (evaluation: ${f.bestEval}).
Opponent's strongest reply to their move, then the continuation: ${f.refutationLine.join(" ") || "n/a"}.
${f.materialLoss ? `In the engine's line the learner loses about ${f.materialLoss} points of material.\n` : ""}
Verified summary (already correct):
${mistakeFallback(f)}

${REWRITE_RULES}`,
    },
  ];
}

/** The tactic was found and verified by chess.js + Stockfish; the model only phrases it. */
function tacticPrompt(f: MistakeFacts, t: TacticalFacts): LLMMessage[] {
  const facts = {
    learnerMove: t.learnerMove,
    opponentMove: t.opponentMove,
    motif: t.motif,
    relation:
      t.relation === "already_present"
        ? "the threat already existed and the learner's move did not deal with it"
        : "the learner's move allows it",
    attacker: t.attacker,
    targets: t.targets,
    ...(t.revealedPiece ? { revealedPiece: t.revealedPiece } : {}),
    followUp: t.followUp,
    engineVerified: t.engineVerified,
    learnerIs: f.playerColor,
    learnerMoves: moveSides(f).learner,
    opponentMoves: moveSides(f).opponent,
    evaluationAfterLearnerMove: f.playedEval,
    evaluationAfterBestMove: f.bestEval,
    betterMove: f.bestSan,
  };
  return [
    {
      role: "system",
      content: `${SYSTEM}
- The facts below were computed and verified by a chess engine. Treat them as the only truth.
- Do not change any move or square, do not invent tactical motifs, and do not add other analysis.
- "motif" names the tactic (fork, pin, skewer, hanging_piece, discovered_check, discovered_attack, remove_defender, sacrifice); explain it simply for a beginner.`,
    },
    {
      role: "user",
      content: `Verified facts (JSON):
${JSON.stringify(facts)}

Verified summary (already correct):
${mistakeFallback(f)}

${REWRITE_RULES}`,
    },
  ];
}

export function recapPrompt(f: RecapFacts): LLMMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Concepts the learner met: ${f.concepts.join("; ")}.
Principle to remember: ${f.principle}
${
  f.mistake
    ? `Their mistake: they played ${f.mistake.playedSan} where ${f.mistake.bestSan} was better.`
    : "They found the best move without a mistake."
}

Write ONE concise takeaway sentence (max 30 words) they can remember next time. Address the learner as "you".`,
    },
  ];
}

// ----- Deterministic fallbacks (used when there is no API key or the call fails) -----

/**
 * Deterministic explanation. Uses only facts established for this move:
 *  1. a verified tactic, else
 *  2. what the engine line concretely does (its reply, material lost), else
 *  3. neutral wording. Never scenario copy, never an invented reason.
 */
export function mistakeFallback(f: MistakeFacts): string {
  if (f.tactic) {
    return `${tacticExplanation(f.tactic)} Stockfish agrees: you'd stand at ${f.playedEval} instead of ${f.bestEval} after ${f.bestSan}.`;
  }
  const reply = f.refutationLine[0];
  const parts = [
    `This move is less accurate. Stockfish prefers ${f.bestSan}, which keeps a better position (${f.bestEval} instead of ${f.playedEval}).`,
  ];
  if (reply) parts.push(`After ${f.playedSan}, its strongest reply is ${reply}.`);
  if (f.materialLoss) parts.push(`In its main line you lose about ${f.materialLoss} points of material.`);
  return parts.join(" ");
}

export function recapFallback(): string {
  return TRAINING.takeaway;
}

// ----- Guarding LLM output -----

const stripCheck = (san: string) => san.replace(/[+#]/g, "");
const SQUARE = /\b[a-h][1-8]\b/g;
const PIECE_MOVE = /\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|O-O(?:-O)?)[+#]?/g;

const MAX_WORDS = 70;
// Outcome verbs followed, within a few words, by something material ("gaining a full point",
// "winning a piece", "you lose about 3 points"). Each such phrase must already be in the summary.
const OUTCOME_CLAIM =
  /\b(?:win|wins|winning|won|gain|gains|gaining|lose|loses|losing|lost)\s+(?:[\w.'’−+-]+\s+){0,3}?(?:points?|pieces?|pawns?|knights?|bishops?|rooks?|queens?|material)\b/gi;
const MOTIF_TERMS: [RegExp, Motif[]][] = [
  [/\bfork\w*/i, ["fork"]],
  [/\bpin(?:s|ned|ning)?\b/i, ["pin"]],
  [/\bskewer\w*/i, ["skewer"]],
  [/\bsacrific\w*/i, ["sacrifice"]],
  [/\bdiscovered\b/i, ["discovered_check", "discovered_attack"]],
  [/\bhang(?:s|ing)?\b/i, ["hanging_piece"]],
  [/\b(?:removing|removes?|remove) the defender|\bdefender\b/i, ["remove_defender"]],
  [/\b(?:deflect|decoy|overload|zugzwang|zwischenzug|back[- ]rank|smothered|x-ray|battery|desperado)\w*/i, []],
];

const NUMBER_WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

/** Numbers the model may use: the ones we gave it (evaluations and material). */
function allowedNumbers(f: MistakeFacts): Set<string> {
  const ok = new Set<string>();
  for (const e of [f.playedEval, f.bestEval]) for (const n of e.match(/\d+(?:\.\d+)?/g) ?? []) ok.add(n);
  if (f.materialLoss) ok.add(String(f.materialLoss));
  return ok;
}

function numberProblems(text: string, f: MistakeFacts): string[] {
  const ok = allowedNumbers(f);
  // Strip move notation so "Qf3+" or "d4" are not read as numbers.
  const prose = text.replace(PIECE_MOVE, " ").replace(SQUARE, " ").replace(/\b[a-h]x[a-h][1-8]\b/g, " ");
  const problems: string[] = [];
  // "two pieces" is fine when a tactic really hits two pieces (checked further down).
  const nTargets = f.tactic ? String(f.tactic.targets.length) : null;
  const numbers = prose.replace(/\b(\d+|two|three|four|five|six)\s+pieces\b/gi, (m, n: string) =>
    (NUMBER_WORDS[n.toLowerCase()] ?? n) === nTargets ? " " : m,
  );
  for (const m of numbers.match(/\b(?:\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten)\b/gi) ?? []) {
    const n = NUMBER_WORDS[m.toLowerCase()] ?? m;
    if (!ok.has(n)) problems.push(`number not in facts: ${m}`);
  }
  // Only "points of material" was established; a count of pieces is allowed just for a tactic's targets.
  const counted = prose.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+pieces\b/i);
  if (counted) {
    const n = NUMBER_WORDS[counted[1].toLowerCase()] ?? counted[1];
    if (!(f.tactic && n === String(f.tactic.targets.length))) problems.push(`pieces vs points: ${counted[0]}`);
  }
  return problems;
}

/**
 * Catches "you play <opponent's move>" and "your opponent plays <learner's move>".
 * Conservative: only judges a move whose own clause names a clear subject.
 */
function roleProblems(text: string, f: MistakeFacts): string[] {
  const sides = moveSides(f);
  const opponentMoves = new Set(sides.opponent.map(stripCheck));
  const learnerMoves = new Set(sides.learner.map(stripCheck));
  const opponentColor = f.playerColor === "White" ? "Black" : "White";
  const problems: string[] = [];
  for (const match of text.matchAll(new RegExp(PIECE_MOVE.source + "|\\b[a-h]x[a-h][1-8]\\b", "g"))) {
    const move = stripCheck(match[0]);
    const clause = text.slice(0, match.index).split(/[.;:!?—–]|,/).pop() ?? "";
    const youSubject = /\byou(?:'ll|'d)?\b/i.test(clause);
    const opponentSubject = new RegExp(`\\b(?:opponent|they|${opponentColor})\\b`, "i").test(clause);
    if (opponentMoves.has(move) && youSubject && !opponentSubject) problems.push(`wrong side: ${move} is your opponent's move`);
    if (learnerMoves.has(move) && opponentSubject && !youSubject) problems.push(`wrong side: ${move} is your move`);
  }
  return problems;
}

/** Models like to add markdown emphasis; the UI shows plain text. */
export function cleanLLMText(text: string): string {
  return text.replace(/[*_`]{1,3}/g, "").replace(/\s+/g, " ").trim();
}

/** Everything in `text` that the supplied facts do not support. Empty means the text is faithful. */
export function unsupportedClaims(text: string, f: MistakeFacts): string[] {
  const t = f.tactic;
  const moves = new Set<string>(
    [f.playedSan, f.bestSan, ...f.refutationLine, ...f.bestLine, ...(t ? [t.learnerMove, t.opponentMove, ...t.followUp] : [])].map(
      stripCheck,
    ),
  );
  const squares = new Set<string>();
  for (const m of moves) for (const sq of m.match(SQUARE) ?? []) squares.add(sq);
  if (t) for (const p of [t.attacker, ...t.targets, ...(t.revealedPiece ? [t.revealedPiece] : [])]) squares.add(p.square);

  const problems: string[] = [];
  for (const token of text.match(PIECE_MOVE) ?? []) {
    if (!moves.has(stripCheck(token))) problems.push(`move not in facts: ${token}`);
  }
  for (const sq of text.match(SQUARE) ?? []) {
    if (!squares.has(sq)) problems.push(`square not in facts: ${sq}`);
  }
  if (t && !text.includes(stripCheck(t.opponentMove))) problems.push(`never names the tactical move ${t.opponentMove}`);

  // The model may not name a tactic other than the verified one (or any tactic when none was found).
  for (const [term, motifs] of MOTIF_TERMS) {
    const hit = text.match(term)?.[0];
    if (hit && !(t && motifs.includes(t.motif))) problems.push(`tactic not established: ${hit}`);
  }
  // "Giving up a <piece>" must name the piece that is actually given up.
  const gave = text.match(/\bgiv(?:e|es|ing) up (?:a |an |the |their |its |your )?(pawn|knight|bishop|rook|queen)\b/i);
  if (gave && gave[1].toLowerCase() !== t?.sacrificedPiece) problems.push(`wrong piece given up: ${gave[1]}`);
  // Outcome claims ("winning a piece", "gaining material") must already be in the verified summary.
  const summary = mistakeFallback(f).toLowerCase();
  for (const claim of text.match(OUTCOME_CLAIM) ?? []) {
    if (!summary.includes(claim.toLowerCase())) problems.push(`outcome not in facts: ${claim}`);
  }
  // Nothing in the facts ever mentions mate, so talk of it is invention.
  const mate = text.match(/\b(?:check ?mate\w*|mating|mate)\b/i)?.[0];
  if (mate) problems.push(`not in facts: ${mate}`);
  if (text.trim().split(/\s+/).length > MAX_WORDS) problems.push("too long");
  problems.push(...roleProblems(text, f), ...numberProblems(text, f));
  return [...new Set(problems)];
}

/**
 * The model may only restate what we gave it. Reject text that names a move or square that is
 * not in the supplied facts, or (when a tactic was found) never names the tactical move.
 */
export function explanationMatchesFacts(text: string, f: MistakeFacts): boolean {
  return unsupportedClaims(text, f).length === 0;
}
