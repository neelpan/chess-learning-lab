import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type { PieceName, PieceRef } from "./types";
import { parseUci } from "../chess-utils";

export const PIECE_NAMES: Record<PieceSymbol, PieceName> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Material values in pawns. The king is only used for ordering (pin/skewer direction). */
export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const other = (c: Color): Color => (c === "w" ? "b" : "w");

export function pieceRef(type: PieceSymbol, color: Color, square: string): PieceRef {
  return { piece: PIECE_NAMES[type], color: color === "w" ? "white" : "black", square };
}

/** Plays a UCI line from `fen`, stopping at the first illegal move. */
export function playLine(fen: string, uciLine: string[], maxPlies = 10): Move[] {
  const game = new Chess(fen);
  const moves: Move[] = [];
  for (const uci of uciLine.slice(0, maxPlies)) {
    try {
      moves.push(game.move(parseUci(uci)));
    } catch {
      break;
    }
  }
  return moves;
}

/**
 * Net material `side` wins over the first `plies` plies of a line, extended through any
 * immediately following captures so an unfinished exchange is never counted half-way.
 */
export function materialGain(line: Move[], side: Color, plies = 4): number {
  let gain = 0;
  for (let i = 0; i < line.length; i++) {
    const m = line[i];
    if (i >= plies && !m.captured) break;
    if (m.captured) gain += (m.color === side ? 1 : -1) * VALUE[m.captured];
  }
  return gain;
}

export function pieces(game: Chess, color: Color): { type: PieceSymbol; square: Square }[] {
  return game
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => !!p && p.color === color)
    .map((p) => ({ type: p.type, square: p.square }));
}
