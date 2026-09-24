import { Chess, type Move } from "chess.js";

export type Uci = { from: string; to: string; promotion?: string };

export function parseUci(uci: string): Uci {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

/** Plays a UCI move on a copy of the position. Returns null if illegal. */
export function tryMove(fen: string, move: Uci): { move: Move; fen: string } | null {
  const game = new Chess(fen);
  try {
    const played = game.move(move);
    return { move: played, fen: game.fen() };
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string): string | null {
  return tryMove(fen, parseUci(uci))?.move.san ?? null;
}

/** Converts a UCI line into SAN, stopping at the first illegal move. */
export function lineToSan(fen: string, uciLine: string[], maxPlies = 6): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciLine.slice(0, maxPlies)) {
    try {
      out.push(game.move(parseUci(uci)).san);
    } catch {
      break;
    }
  }
  return out;
}

/** "+0.4" / "−1.2" / "M3" — always from the learner's point of view. */
export function formatEval(cp: number, mate: number | null): string {
  if (mate !== null) return mate > 0 ? `M${mate}` : `−M${Math.abs(mate)}`;
  const pawns = cp / 100;
  if (Math.abs(pawns) < 0.05) return "0.0";
  return `${pawns > 0 ? "+" : "−"}${Math.abs(pawns).toFixed(1)}`;
}

export function colorName(fen: string): "White" | "Black" {
  return fen.split(" ")[1] === "w" ? "White" : "Black";
}
