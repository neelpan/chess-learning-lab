"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Chessboard, type Arrow } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import type { Uci } from "@/lib/chess-utils";

type Props = {
  fen: string;
  orientation?: "white" | "black";
  /** Which side the learner may move right now; null makes the board read-only. */
  movableColor: "w" | "b" | null;
  /** Return true if the move was legal and accepted. */
  onMove?: (move: Uci) => boolean;
  lastMove?: { from: string; to: string } | null;
  focusSquares?: string[];
  arrows?: Arrow[];
};

const LIGHT = "#ece5d3";
const DARK = "#7c9a86";

export function ChessBoard({
  fen,
  orientation = "white",
  movableColor,
  onMove,
  lastMove,
  focusSquares = [],
  arrows = [],
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const game = useMemo(() => new Chess(fen), [fen]);

  const targets = useMemo(() => {
    if (!selected || game.turn() !== movableColor) return [];
    return game.moves({ square: selected as Square, verbose: true }).map((m) => m.to as string);
  }, [selected, game, movableColor]);

  function attempt(from: string, to: string): boolean {
    if (!onMove || !movableColor) return false;
    const piece = game.get(from as Square);
    if (!piece || piece.color !== movableColor || game.turn() !== movableColor) return false;
    const lastRank = movableColor === "w" ? "8" : "1";
    const promotion = piece.type === "p" && to.endsWith(lastRank) ? "q" : undefined;
    const ok = onMove({ from, to, promotion });
    setSelected(null);
    return ok;
  }

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    for (const sq of focusSquares) {
      styles[sq] = { boxShadow: "inset 0 0 0 4px rgba(184, 137, 43, 0.85)" };
    }
    if (lastMove) {
      for (const sq of [lastMove.from, lastMove.to]) {
        styles[sq] = { ...styles[sq], backgroundColor: "rgba(226, 196, 84, 0.55)" };
      }
    }
    if (selected) {
      styles[selected] = { ...styles[selected], backgroundColor: "rgba(226, 196, 84, 0.8)" };
    }
    for (const sq of targets) {
      const occupied = game.get(sq as Square);
      styles[sq] = {
        ...styles[sq],
        backgroundImage: occupied
          ? "radial-gradient(circle, transparent 58%, rgba(23, 69, 58, 0.45) 60%)"
          : "radial-gradient(circle, rgba(23, 69, 58, 0.4) 20%, transparent 22%)",
      };
    }
    return styles;
  }, [focusSquares, lastMove, selected, targets, game]);

  return (
    <div className="w-full select-none overflow-hidden rounded-xl shadow-[0_10px_40px_-12px_rgba(29,35,32,0.35)] ring-1 ring-black/10">
      <Chessboard
        options={{
          id: "board",
          position: fen,
          boardOrientation: orientation,
          allowDragging: movableColor !== null,
          allowDrawingArrows: false,
          animationDurationInMs: 220,
          lightSquareStyle: { backgroundColor: LIGHT },
          darkSquareStyle: { backgroundColor: DARK },
          squareStyles,
          arrows,
          canDragPiece: ({ piece }) => movableColor !== null && piece.pieceType[0] === movableColor,
          onPieceDrop: ({ sourceSquare, targetSquare }) =>
            targetSquare ? attempt(sourceSquare, targetSquare) : false,
          onSquareClick: ({ piece, square }) => {
            if (!movableColor) return;
            if (selected && targets.includes(square)) {
              attempt(selected, square);
            } else if (piece && piece.pieceType[0] === movableColor) {
              setSelected(square === selected ? null : square);
            } else {
              setSelected(null);
            }
          },
        }}
      />
    </div>
  );
}
