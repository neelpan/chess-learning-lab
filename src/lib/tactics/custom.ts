// Detectors for motifs the chess-tactics library does not cover (or mislabels).
// Each one looks only at the engine's line, verified with plain chess.js geometry.
import { Chess, type Color, type Move } from "chess.js";
import { VALUE, materialGain, other, pieceRef, pieces } from "./board";
import type { Motif, PieceRef } from "./types";

export type Candidate = {
  motif: Motif;
  attacker: PieceRef;
  targets: PieceRef[];
  revealedPiece?: PieceRef;
};

type Context = {
  /** The engine's line for the opponent, starting with the tactical move. */
  line: Move[];
  learner: Color;
};

export const MIN_GAIN = 2;

/** The learner piece the opponent captures on `line[index]`, if any. */
function capturedTarget(line: Move[], index: number, learner: Color): PieceRef | null {
  const m = line[index];
  if (!m?.captured || m.color === learner) return null;
  return pieceRef(m.captured, learner, m.to);
}

/**
 * The opponent captures a minor piece or better and no learner piece can recapture on that
 * square. (A piece merely attacked by a cheaper enemy piece, or defended, is not "hanging".)
 */
export function hangingPiece({ line, learner }: Context): Candidate | null {
  const m = line[0];
  if (!m?.captured || m.color === learner || VALUE[m.captured] < 3) return null;
  if (new Chess(m.after).attackers(m.to, learner).length > 0) return null;
  if (materialGain(line, other(learner)) < MIN_GAIN) return null;
  return {
    motif: "hanging_piece",
    attacker: pieceRef(m.piece, m.color, m.to),
    targets: [pieceRef(m.captured, learner, m.to)],
  };
}

/** Moving a piece uncovers a check from another piece, and the engine line wins material. */
export function discoveredCheck({ line, learner }: Context): Candidate | null {
  const m = line[0];
  if (!m) return null;
  const after = new Chess(m.after);
  if (!after.inCheck()) return null;

  const king = pieces(after, learner).find((p) => p.type === "k");
  if (!king) return null;
  const hidden = after.attackers(king.square, other(learner)).filter((sq) => sq !== m.to);
  if (!hidden.length) return null;
  if (materialGain(line, other(learner)) < MIN_GAIN) return null;

  const revealer = after.get(hidden[0]);
  if (!revealer) return null;
  const won = [capturedTarget(line, 0, learner), capturedTarget(line, 2, learner)].filter(
    (t): t is PieceRef => !!t,
  );
  return {
    motif: "discovered_check",
    attacker: pieceRef(m.piece, m.color, m.to),
    targets: won.length ? won : [pieceRef("k", learner, king.square)],
    revealedPiece: pieceRef(revealer.type, revealer.color, hidden[0]),
  };
}

/** Moving a piece uncovers a slider's attack on a learner piece, which the slider then captures. */
export function discoveredAttack({ line, learner }: Context): Candidate | null {
  const m = line[0];
  if (!m) return null;
  const before = new Chess(m.before);
  const after = new Chess(m.after);
  const opp = other(learner);
  if (materialGain(line, opp) < MIN_GAIN) return null;

  let best: Candidate | null = null;
  let bestValue = 0;
  for (const target of pieces(after, learner)) {
    if (target.type === "k" || target.type === "p" || target.square === m.to) continue;
    const seenBefore = before.attackers(target.square, opp);
    const uncovered = after
      .attackers(target.square, opp)
      .filter((sq) => sq !== m.to && !seenBefore.includes(sq));
    if (!uncovered.length) continue;

    // The uncovered piece must actually go on to take the target in the engine line.
    const follow = line[2];
    if (!follow?.captured || follow.to !== target.square || !uncovered.includes(follow.from)) continue;

    const revealer = after.get(uncovered[0]);
    if (!revealer || VALUE[target.type] <= bestValue) continue;
    bestValue = VALUE[target.type];
    best = {
      motif: "discovered_attack",
      attacker: pieceRef(m.piece, m.color, m.to),
      targets: [pieceRef(target.type, learner, target.square)],
      revealedPiece: pieceRef(revealer.type, revealer.color, follow.from),
    };
  }
  return best;
}

/**
 * The opponent captures a piece that was guarding another learner piece; the guarded piece
 * is left under-defended and the engine line then wins it.
 */
export function removeDefender({ line, learner }: Context): Candidate | null {
  const m = line[0];
  // Taking a more valuable piece is simply winning material, not "removing a defender".
  if (!m?.captured || VALUE[m.captured] > VALUE[m.piece]) return null;
  const before = new Chess(m.before);
  const after = new Chess(m.after);
  const opp = other(learner);
  if (materialGain(line, opp) < MIN_GAIN) return null;

  let best: Candidate | null = null;
  let bestValue = 0;
  for (const target of pieces(after, learner)) {
    if (target.type === "k" || target.square === m.to) continue;
    const wasGuardedByCaptured = before.attackers(target.square, learner).includes(m.to);
    const wasAttacked = before.attackers(target.square, opp).length > 0;
    if (!wasGuardedByCaptured || !wasAttacked) continue;
    if (after.attackers(target.square, learner).length >= after.attackers(target.square, opp).length) {
      continue;
    }

    // The engine line has to actually capture the weakened piece.
    const taken = [2, 4].map((i) => line[i]).find((x) => x?.captured && x.to === target.square);
    if (!taken || VALUE[target.type] <= bestValue) continue;
    bestValue = VALUE[target.type];
    best = {
      motif: "remove_defender",
      attacker: pieceRef(m.piece, m.color, m.to),
      // First the defender that is removed, then the piece it was guarding.
      targets: [pieceRef(m.captured, learner, m.to), pieceRef(target.type, learner, target.square)],
    };
  }
  return best;
}
