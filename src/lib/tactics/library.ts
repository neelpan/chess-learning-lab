// Adapter around `chess-tactics` (GPL-3.0-or-later): given a position and an engine line,
// it finds fork / pin / skewer / sacrifice and checks the line wins material.
//
// We wrap it because the library (v0.0.x) can throw on some lines, and a few of its labels
// need an extra guard before we show them to a learner (see `guard` in analyze.ts).
// Its "hanging piece" detector is not used: ours also requires that no recapture exists.
import { ChessTactics, type TacticKey } from "chess-tactics";
import { pieceRef } from "./board";
import type { Candidate } from "./custom";
import type { Motif } from "./types";

const KEY_TO_MOTIF: Partial<Record<TacticKey, Motif>> = {
  fork: "fork",
  pin: "pin",
  skewer: "skewer",
  sacrifice: "sacrifice",
};

export type LibraryInput = {
  afterFen: string;
  /** Engine line for the opponent from the position after the learner's move (UCI). */
  line: string[];
};

export function libraryCandidates(input: LibraryInput): Candidate[] {
  const found: Candidate[] = [];
  for (const key of Object.keys(KEY_TO_MOTIF) as TacticKey[]) {
    try {
      const result = new ChessTactics([key]).classify(
        {
          position: input.afterFen,
          evaluation: { sequence: input.line },
        },
        // Only tactics the opponent can play *immediately* — "after X, I can play Y".
        { maxLookaheadMoves: 0, trimEndSequence: true },
      );
      for (const t of result) {
        const motif = KEY_TO_MOTIF[t.type];
        const first = t.sequence[0];
        if (!motif || t.triggerIndex !== 0 || !first) continue;
        found.push({
          motif,
          attacker: pieceRef(first.piece, first.color, first.to),
          targets: t.attackedPieces.map((a) => pieceRef(a.piece.type, a.piece.color, a.square)),
        });
      }
    } catch {
      // A library failure must never break the lesson; the deterministic fallback takes over.
    }
  }
  return found;
}
