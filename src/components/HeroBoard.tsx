"use client";

import { ChessBoard } from "./ChessBoard";
import { TRAINING } from "@/content/curriculum";

/** Read-only board used as the landing-page visual. */
export function HeroBoard() {
  return (
    <ChessBoard
      fen={TRAINING.fen}
      orientation="black"
      movableColor={null}
      focusSquares={TRAINING.focusSquares}
      arrows={[{ startSquare: "c6", endSquare: "a5", color: "rgba(44, 122, 75, 0.9)" }]}
    />
  );
}
