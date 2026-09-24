// Pure UCI output parsing, shared by the browser worker engine and the Node test engine.

export type EngineLine = {
  /** Centipawns from the side-to-move's perspective (mate scores are clamped). */
  cp: number;
  /** Moves to mate (positive = side to move mates), or null. */
  mate: number | null;
  /** Principal variation in UCI notation. */
  pv: string[];
};

export type Analysis = EngineLine & {
  bestMove: string;
  /** Top lines, best first. Length is at most the requested MultiPV. */
  lines: EngineLine[];
};

export const MATE_CP = 1000;

const clamp = (cp: number) => Math.max(-MATE_CP, Math.min(MATE_CP, cp));

/** Feed engine output lines; returns the finished Analysis when `bestmove` arrives. */
export class SearchCollector {
  private lines = new Map<number, EngineLine>();

  feed(line: string): Analysis | null {
    if (line.startsWith("info") && line.includes(" score ") && line.includes(" pv ")) {
      const score = line.match(/score (cp|mate) (-?\d+)/);
      if (!score) return null;
      const index = Number(line.match(/multipv (\d+)/)?.[1] ?? 1);
      const isMate = score[1] === "mate";
      const value = Number(score[2]);
      this.lines.set(index, {
        cp: isMate ? Math.sign(value) * MATE_CP : clamp(value),
        mate: isMate ? value : null,
        pv: line.split(" pv ")[1].trim().split(/\s+/),
      });
      return null;
    }
    if (line.startsWith("bestmove")) {
      const bestMove = line.split(/\s+/)[1];
      const ordered = [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
      const lines = ordered.length ? ordered : [{ cp: 0, mate: null, pv: [bestMove] }];
      return { ...lines[0], bestMove, lines };
    }
    return null;
  }
}

/** UCI commands for one search. MultiPV is set every time so searches never inherit it. */
export function searchCommands(fen: string, depth: number, multiPv: number): string[] {
  return [
    "ucinewgame", // clear the hash so identical positions always give identical evaluations
    `setoption name MultiPV value ${multiPv}`,
    `position fen ${fen}`,
    `go depth ${depth}`,
  ];
}
