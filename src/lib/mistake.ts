import { Chess } from "chess.js";
import { lineToSan } from "./chess-utils";
import type { MistakeFacts } from "./teaching";
import { MIN_GAIN } from "./tactics/custom";
import { materialGain, other, playLine } from "./tactics/board";
import type { TacticalFacts } from "./tactics/types";

/**
 * Builds the facts for an explanation of an inferior move, purely from engine output and chess.js.
 * No scenario text goes in: anything the learner reads must be established for this move.
 */
export function buildMistakeFacts(params: {
  beforeFen: string;
  afterFen: string;
  playedSan: string;
  bestSan: string;
  playedEval: string;
  bestEval: string;
  /** Stockfish's line for the opponent after the learner's move (UCI). */
  replyPv: string[];
  /** Stockfish's line for the learner's best move (UCI, from beforeFen). */
  bestPv: string[];
  tactic: TacticalFacts | null;
}): MistakeFacts {
  const learner = new Chess(params.beforeFen).turn();
  const loss = materialGain(playLine(params.afterFen, params.replyPv, 8), other(learner));
  return {
    playerColor: learner === "w" ? "White" : "Black",
    playedSan: params.playedSan,
    bestSan: params.bestSan,
    playedEval: params.playedEval,
    bestEval: params.bestEval,
    refutationLine: lineToSan(params.afterFen, params.replyPv, 4),
    bestLine: lineToSan(params.beforeFen, params.bestPv, 5),
    ...(loss >= MIN_GAIN ? { materialLoss: loss } : {}),
    tactic: params.tactic,
  };
}
