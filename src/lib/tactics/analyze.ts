// Forward-looking tactical analysis.
//
//   learner move → Stockfish (top replies) → candidate tactic → guards → engine-verified facts
//
// Stockfish decides what the opponent's strongest replies are; chess.js supplies geometry;
// the detectors only *interpret* an engine line. Nothing here is guessed by a language model.
import { Chess, type Color, type Move } from "chess.js";
import type { AnalysisEngine, Analysis } from "../engine";
import { lineToSan } from "../chess-utils";
import { materialGain, other, playLine } from "./board";
import {
  MIN_GAIN,
  discoveredAttack,
  discoveredCheck,
  hangingPiece,
  removeDefender,
  type Candidate,
} from "./custom";
import { libraryCandidates } from "./library";
import type { Motif, PieceRef, Relation, TacticalFacts } from "./types";

/**
 * Only replies within this many centipawns of Stockfish's top reply are considered — in practice
 * the top reply, or a near-tie. Wider values report tactics that are not the real problem.
 */
export const LINE_TOLERANCE_CP = 15;
/** The learner's move must be at least this much worse than their best move. */
export const MIN_LOSS_CP = 40;
export const SEARCH_DEPTH = 14;
export const CANDIDATE_LINES = 3;

/** Most specific explanation first. */
const PRIORITY: Motif[] = [
  "discovered_check",
  "discovered_attack",
  "remove_defender",
  "skewer",
  "pin",
  "fork",
  "hanging_piece",
  "sacrifice",
];

export type ConsequenceInput = {
  engine: AnalysisEngine;
  beforeFen: string;
  learnerMove: { from: string; to: string; promotion?: string };
  /** Stockfish's analysis of `beforeFen` (learner to move). */
  baseline: Analysis;
  /** Optional multi-line analysis of the position after the move, if the caller already has it. */
  after?: Analysis;
  depth?: number;
};

export async function findTacticalConsequence(input: ConsequenceInput): Promise<TacticalFacts | null> {
  const { engine, beforeFen, baseline, depth = SEARCH_DEPTH } = input;

  const game = new Chess(beforeFen);
  const learnerColor = game.turn();
  let learnerMove: Move;
  try {
    learnerMove = game.move(input.learnerMove);
  } catch {
    return null;
  }
  if (game.isGameOver()) return null;
  const afterFen = game.fen();

  const after =
    input.after && input.after.lines.length >= CANDIDATE_LINES
      ? input.after
      : await engine.analyse(afterFen, { depth, multiPv: CANDIDATE_LINES });

  // Loss for the learner: their best move's score versus the score after this move.
  const lossCp = baseline.cp + after.lines[0].cp;
  if (lossCp < MIN_LOSS_CP) return null;

  const top = after.lines[0].cp;
  for (const [index, engineLine] of after.lines.entries()) {
    if (top - engineLine.cp > LINE_TOLERANCE_CP) break;

    const pv = await extendLine(engine, afterFen, engineLine.pv);
    const line = playLine(afterFen, pv);
    if (!line.length) continue;

    const candidates = detectCandidates({ afterFen, line, engineLine: pv, learnerColor });
    const chosen = candidates.sort((a, b) => PRIORITY.indexOf(a.motif) - PRIORITY.indexOf(b.motif))[0];
    if (!chosen) continue;

    const first = line[0];
    const relation = await classifyRelation({
      engine,
      beforeFen,
      opponentUci: first.from + first.to + (first.promotion ?? ""),
      depth,
    });
    return {
      learnerMove: learnerMove.san,
      opponentMove: first.san,
      opponentMoveUci: first.from + first.to + (first.promotion ?? ""),
      motif: chosen.motif,
      relation,
      attacker: chosen.attacker,
      targets: chosen.targets,
      ...(chosen.revealedPiece ? { revealedPiece: chosen.revealedPiece } : {}),
      followUp: lineToSan(afterFen, pv, 5).slice(1),
      materialGain: materialGain(line, other(learnerColor)),
      ...(chosen.motif === "sacrifice" && line[1]?.captured && line[1].to === first.to
        ? { sacrificedPiece: chosen.attacker.piece }
        : {}),
      engineVerified: true,
      engineRank: index + 1,
      centipawnLoss: lossCp,
    };
  }
  return null;
}

/** Minimum plies needed to judge a tactic (move, reply, capture, recapture). */
const MIN_LINE_PLIES = 6;

/**
 * Stockfish sometimes returns a truncated principal variation (a couple of plies). Without the
 * follow-up captures we cannot tell whether a tactic wins material, so continue the line with a
 * short extra search from where it ended. Cheap: at most two small searches per candidate.
 */
export async function extendLine(engine: AnalysisEngine, startFen: string, pv: string[]): Promise<string[]> {
  let line = [...pv];
  for (let round = 0; round < 2; round++) {
    const played = playLine(startFen, line, 20);
    if (played.length >= MIN_LINE_PLIES || played.length < line.length) break;
    const endFen = played[played.length - 1].after;
    if (new Chess(endFen).isGameOver()) break;
    const next = await engine.analyse(endFen, { depth: 10, multiPv: 1 });
    if (next.bestMove === "(none)" || !next.pv.length) break;
    line = [...line, ...next.pv];
  }
  return line;
}

export type DetectInput = {
  afterFen: string;
  line: Move[];
  engineLine: string[];
  learnerColor: Color;
};

/** Runs every detector on one engine line, then applies the guards below. */
export function detectCandidates(input: DetectInput): Candidate[] {
  const { line, learnerColor } = input;
  const context = { line, learner: learnerColor };
  const raw: Candidate[] = [
    discoveredCheck(context),
    discoveredAttack(context),
    removeDefender(context),
    hangingPiece(context),
    ...libraryCandidates({ afterFen: input.afterFen, line: input.engineLine }),
  ].filter((c): c is Candidate => !!c);
  return raw.filter((c) => guard(c, line, learnerColor));
}

const VALUE_OF: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };

/**
 * Extra checks so a geometric pattern is only reported when it really works.
 * They exist because the raw patterns produce false positives, for example:
 *  - a "fork" by a piece that is simply captured on its next move;
 *  - a "pin" of a pawn, or a pin whose pinner never wins anything;
 *  - a "sacrifice" where the opponent loses nothing.
 */
function guard(c: Candidate, line: Move[], learner: Color): boolean {
  const first = line[0];
  const reply = line[1];
  const opp = other(learner);

  const lineTactic = c.motif === "fork" || c.motif === "pin" || c.motif === "skewer";
  if (lineTactic && reply?.captured && reply.to === first.to) return false; // the tactic piece is just taken

  if (c.motif === "sacrifice") {
    // Something must actually be given up: the reply wins back more than the move took.
    return c.targets.length > 0 && materialGain(line.slice(0, 2), opp) < 0;
  }

  // Everything else must win real material along the engine line.
  if (materialGain(line, opp) < MIN_GAIN) return false;

  if (lineTactic) {
    const after = new Chess(first.after);
    const attacked = (sq: string) => after.attackers(sq as never, opp).includes(first.to);
    const [front, behind] = c.targets;

    if (c.motif === "fork" && (c.targets.length < 2 || !c.targets.every((t) => attacked(t.square)))) {
      return false;
    }
    if (c.motif === "pin" || c.motif === "skewer") {
      if (!front || !behind || !attacked(front.square)) return false;
      // A pin hits the cheaper piece in front; a skewer hits the more valuable one.
      const shapeOk =
        c.motif === "pin"
          ? VALUE_OF[front.piece] < VALUE_OF[behind.piece]
          : VALUE_OF[front.piece] > VALUE_OF[behind.piece];
      if (!shapeOk || VALUE_OF[front.piece] < 3) return false; // pinning a pawn is not a tactic worth naming
    }
    // The tactic must pay off by the tactic piece itself capturing one of its targets.
    if (!tacticPieceCapturesTarget(line, first.to, c.targets.map((t) => t.square))) return false;
  }
  return true;
}

/** Follows the tactic piece through the engine line: does it capture one of the targets? */
function tacticPieceCapturesTarget(line: Move[], landing: string, targets: string[]): boolean {
  let square = landing;
  for (let i = 2; i < Math.min(line.length, 6); i += 2) {
    const m = line[i];
    if (m.from !== square) continue;
    if (m.captured && targets.includes(m.to)) return true;
    square = m.to;
  }
  return false;
}

/**
 * Would the same reply have been just as strong had the learner made no move at all?
 * If so the threat pre-dated the move ("already present"); otherwise the move allowed it.
 */
async function classifyRelation(params: {
  engine: AnalysisEngine;
  beforeFen: string;
  opponentUci: string;
  depth: number;
}): Promise<Relation> {
  try {
    const before = new Chess(params.beforeFen);
    if (before.inCheck()) return "unknown";
    const parts = params.beforeFen.split(" ");
    parts[1] = parts[1] === "w" ? "b" : "w"; // pretend the learner passes
    parts[3] = "-";
    const passFen = parts.join(" ");
    new Chess(passFen); // throws if the position is not valid

    const result = await params.engine.analyse(passFen, { depth: params.depth, multiPv: CANDIDATE_LINES });
    const top = result.lines[0].cp;
    const stillWorks = result.lines.some(
      (l) => l.pv[0] === params.opponentUci && top - l.cp <= LINE_TOLERANCE_CP,
    );
    return stillWorks ? "already_present" : "created_by_move";
  } catch {
    return "unknown";
  }
}

export type { TacticalFacts, PieceRef };
