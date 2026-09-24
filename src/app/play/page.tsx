"use client";

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "@/components/ChessBoard";
import { useSession } from "@/components/SessionProvider";
import { Badge, Button, Eyebrow, LinkButton, Panel } from "@/components/ui";
import { parseUci, tryMove, type Uci } from "@/lib/chess-utils";
import { getEngine } from "@/lib/engine";
import {
  PLAY_SCENARIO,
  PLAY_SETUP_MOVES,
  SCRIPTED_REPLIES,
  recogniseConcept,
  type Concept,
} from "@/content/curriculum";

function initialGame() {
  const game = new Chess();
  for (const san of PLAY_SETUP_MOVES) game.move(san);
  return { fen: game.fen(), moves: game.history() };
}

const START = initialGame();

function formatMoves(moves: string[]) {
  const parts: string[] = [];
  moves.forEach((san, i) => {
    parts.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san);
  });
  return parts.join(" ");
}

export default function PlayPage() {
  const { addConcept } = useSession();
  const [fen, setFen] = useState(START.fen);
  const [moves, setMoves] = useState(START.moves);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [opponentThinking, setOpponentThinking] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const generation = useRef(0); // invalidates in-flight opponent replies on reset
  const conceptRef = useRef<Concept | null>(null); // latest concept, readable from async replies

  const game = new Chess(fen);
  const gameOver = game.isGameOver();
  const learnerCanMove = !opponentThinking && !gameOver;

  function surface(sanMoves: string[]) {
    const found = recogniseConcept(sanMoves);
    // Once a named idea has appeared, don't replace it with the generic fallback.
    if (found.id === "development" && conceptRef.current) return;
    if (conceptRef.current?.id === found.id) return;
    conceptRef.current = found;
    setConcept(found);
    addConcept(found.id);
  }

  function handleMove(move: Uci): boolean {
    if (!learnerCanMove) return false;
    const result = tryMove(fen, move);
    if (!result) return false;

    const learnerMoves = [...moves, result.move.san];
    setFen(result.fen);
    setMoves(learnerMoves);
    setLastMove({ from: result.move.from, to: result.move.to });
    surface(learnerMoves);
    void replyAsOpponent(result.fen, learnerMoves);
    return true;
  }

  async function replyAsOpponent(position: string, played: string[]) {
    if (new Chess(position).isGameOver()) return;
    const ticket = generation.current;
    setOpponentThinking(true);
    try {
      // Third-move replies are scripted so the demo lines are reliable; after that, Stockfish plays.
      const scripted = played.length === PLAY_SETUP_MOVES.length + 1 ? SCRIPTED_REPLIES[played[played.length - 1]] : undefined;
      let uci: string;
      if (scripted) {
        const probe = new Chess(position);
        const m = probe.move(scripted);
        uci = m.from + m.to + (m.promotion ?? "");
      } else {
        uci = (await getEngine().analyse(position, { depth: 8 })).bestMove;
      }
      await new Promise((r) => setTimeout(r, 450));
      if (ticket !== generation.current) return;

      const reply = tryMove(position, parseUci(uci));
      if (!reply) return;
      const next = [...played, reply.move.san];
      setFen(reply.fen);
      setMoves(next);
      setLastMove({ from: reply.move.from, to: reply.move.to });
      surface(next);
    } catch {
      if (ticket === generation.current) setEngineError(true);
    } finally {
      if (ticket === generation.current) setOpponentThinking(false);
    }
  }

  function reset() {
    generation.current += 1;
    setFen(START.fen);
    setMoves(START.moves);
    setLastMove(null);
    conceptRef.current = null;
    setConcept(null);
    setOpponentThinking(false);
    setEngineError(false);
  }

  // Warm up the engine while the learner reads, so Training starts instantly.
  useEffect(() => {
    try {
      void getEngine();
    } catch {
      /* surfaced later if it is actually needed */
    }
  }, []);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,600px)_1fr] lg:gap-12 lg:py-12">
      <div className="mx-auto w-full max-w-[600px]">
        <ChessBoard
          fen={fen}
          orientation="white"
          movableColor={learnerCanMove ? "w" : null}
          onMove={handleMove}
          lastMove={lastMove}
          focusSquares={concept?.focusSquares}
        />
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span className="font-mono text-[13px]">{formatMoves(moves)}</span>
          <Button variant="ghost" onClick={reset} className="!px-3 !py-1.5">
            Reset
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <Eyebrow>Step 1 · Play</Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight">
            {PLAY_SCENARIO.title}
          </h1>
          <p className="mt-3 max-w-prose leading-relaxed text-muted">{PLAY_SCENARIO.intro}</p>
        </div>

        {!concept && (
          <Panel>
            <p className="text-sm font-semibold">Your move</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {PLAY_SCENARIO.suggestion} Drag a piece, or click it and then a highlighted square.
            </p>
          </Panel>
        )}

        {concept && (
          <Panel key={concept.id} tone="default" className="border-accent/30">
            <div className="flex items-center gap-2">
              <Badge>{concept.kind}</Badge>
              <span className="text-xs text-muted">Just recognised</span>
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              {concept.name}
            </h2>
            <p className="mt-2 leading-relaxed">{concept.idea}</p>
            <div className="mt-4 rounded-xl bg-accent-soft px-4 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                Why recognising this matters
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink/85">{concept.whyItMatters}</p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <LinkButton href="/train">Test this idea →</LinkButton>
              <span className="text-sm text-muted">
                Or keep playing — the concept updates as the position changes.
              </span>
            </div>
          </Panel>
        )}

        {opponentThinking && <p className="text-sm text-muted">Black is thinking…</p>}
        {gameOver && <p className="text-sm font-medium">The game is over. Reset to try another line.</p>}
        {engineError && (
          <p className="text-sm text-danger">
            The chess engine couldn&apos;t load, so Black can&apos;t reply. Reload the page to try again.
          </p>
        )}
      </div>
    </div>
  );
}
