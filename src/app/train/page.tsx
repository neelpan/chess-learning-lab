"use client";

import { useEffect, useState } from "react";
import type { Arrow } from "react-chessboard";
import { ChessBoard } from "@/components/ChessBoard";
import { useSession } from "@/components/SessionProvider";
import { Badge, Button, Eyebrow, LinkButton, Panel, PrincipleBox } from "@/components/ui";
import { formatEval, lineToSan, parseUci, tryMove, uciToSan, type Uci } from "@/lib/chess-utils";
import { findTacticalConsequence } from "@/lib/tactics/analyze";
import { describeThreats, motifLabel, tacticExplanation } from "@/lib/tactics/describe";
import type { TacticalFacts } from "@/lib/tactics/types";
import { getEngine, type Analysis } from "@/lib/engine";
import { buildMistakeFacts } from "@/lib/mistake";
import { mistakeFallback } from "@/lib/teaching";
import { TRAINING, principleAppliesTo } from "@/content/curriculum";
import { Chess } from "chess.js";

type Phase = "loading" | "ready" | "checking" | "wrong" | "correct";

type Result = {
  playedSan: string;
  bestSan: string;
  playedEval: string;
  bestEval: string;
  verdict: "best" | "good" | "inferior";
  refutation: { san: string; from: string; to: string } | null;
  explanation: string | null; // null while the coach is still writing
  /** Set when Stockfish + chess.js verified a concrete tactic behind the mistake. */
  tactic: TacticalFacts | null;
  /** For good moves: what the move does and where the engine expects it to lead. */
  insight: string | null;
};

const RED = "rgba(169, 63, 44, 0.85)";
const GREEN = "rgba(44, 122, 75, 0.9)";

function parseUciFromSan(san: string): Uci {
  const m = new Chess(TRAINING.fen).move(san);
  return { from: m.from, to: m.to, promotion: m.promotion };
}

export default function TrainPage() {
  const session = useSession();
  const [phase, setPhase] = useState<Phase>("loading");
  const [fen, setFen] = useState(TRAINING.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [baseline, setBaseline] = useState<Analysis | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showBest, setShowBest] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [engineError, setEngineError] = useState(false);

  // Fresh training run each time this page is opened.
  const { resetTraining } = session;
  useEffect(() => {
    resetTraining();
  }, [resetTraining]);

  // Analyse the teaching position once: this is the objective yardstick for every move.
  useEffect(() => {
    let cancelled = false;
    getEngine()
      .analyse(TRAINING.fen)
      .then((analysis) => {
        if (cancelled) return;
        setBaseline(analysis);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setEngineError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bestSan = baseline ? uciToSan(TRAINING.fen, baseline.bestMove) : null;

  function handleMove(move: Uci): boolean {
    if (phase !== "ready" || !baseline || !bestSan) return false;
    const played = tryMove(TRAINING.fen, move);
    if (!played) return false;

    setFen(played.fen);
    setLastMove({ from: played.move.from, to: played.move.to });
    setShowBest(false);
    setPhase("checking");
    void evaluate(baseline, bestSan, played.move.san, move, played.fen);
    return true;
  }

  async function evaluate(
    base: Analysis,
    best: string,
    playedSan: string,
    move: Uci,
    afterFen: string,
  ) {
    const playedUci = move.from + move.to + (move.promotion ?? "");
    const isBest = playedUci === base.bestMove;

    let playedCp = base.cp;
    let playedMate = base.mate;
    let replyPv: string[] = [];
    let after: Analysis | null = null;
    if (!isBest) {
      try {
        // Three lines: the top reply is the refutation; the others are candidates for tactic detection.
        after = await getEngine().analyse(afterFen, { multiPv: 3 });
        // The engine scores from the side to move (the opponent), so flip to the learner's view.
        playedCp = -after.cp;
        playedMate = after.mate === null ? null : -after.mate;
        replyPv = after.bestMove === "(none)" ? [] : after.pv;
      } catch {
        setEngineError(true);
        return;
      }
    }

    const loss = Math.max(0, base.cp - playedCp);
    const verdict: Result["verdict"] = isBest
      ? "best"
      : loss <= TRAINING.acceptableLoss
        ? "good"
        : "inferior";

    const replyUci = replyPv[0];
    const replySan = replyUci ? uciToSan(afterFen, replyUci) : null;
    const reply = replyUci && replySan ? { san: replySan, ...parseUci(replyUci) } : null;
    const playedEval = formatEval(playedCp, playedMate);
    const bestEval = formatEval(base.cp, base.mate);

    const attemptId = session.addAttempt({
      san: playedSan,
      bestSan: best,
      playedEval,
      bestEval,
      verdict,
      refutationSan: reply?.san ?? null,
      explanation: null,
    });

    const summary = { playedSan, bestSan: best, playedEval, bestEval, verdict };

    if (verdict !== "inferior") {
      // What the move does, derived from the position plus Stockfish's expected continuation.
      const line = isBest
        ? lineToSan(TRAINING.fen, base.pv, 5)
        : [playedSan, ...lineToSan(afterFen, replyPv, 4)];
      const insight = [
        describeThreats(TRAINING.fen, playedUci),
        line.length > 1 ? `Stockfish expects ${line.join(" ")}.` : null,
      ]
        .filter(Boolean)
        .join(" ");
      session.markSolved();
      setResult({ ...summary, refutation: null, explanation: null, tactic: null, insight });
      setPhase("correct");
      void explainTemptingMove(base, best);
      return;
    }

    setResult({ ...summary, refutation: reply, explanation: null, tactic: null, insight: null });
    setPhase("wrong");

    // Forward-looking tactical analysis: is there a concrete, engine-verified punishment?
    let tactic: TacticalFacts | null = null;
    try {
      tactic = await findTacticalConsequence({
        engine: getEngine(),
        beforeFen: TRAINING.fen,
        learnerMove: move,
        baseline: base,
        after: after ?? undefined,
      });
    } catch {
      /* no tactic claimed; the deterministic explanation still applies */
    }
    if (tactic) setResult((r) => (r && r.playedSan === playedSan ? { ...r, tactic } : r));

    // Natural-language explanation: LLM when configured, deterministic copy otherwise.
    const facts = buildMistakeFacts({
      beforeFen: TRAINING.fen,
      afterFen,
      playedSan,
      bestSan: best,
      playedEval,
      bestEval,
      replyPv,
      bestPv: base.pv,
      tactic,
    });
    let text = mistakeFallback(facts);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mistake", facts }),
      });
      if (res.ok) text = (await res.json()).text;
    } catch {
      /* keep the fallback */
    }
    session.updateAttempt(attemptId, { explanation: text });
    setResult((r) => (r && r.playedSan === playedSan ? { ...r, explanation: text } : r));
  }

  /** For the recap: explain the classic mistake here with the same pipeline (no hand-written text). */
  async function explainTemptingMove(base: Analysis, best: string) {
    try {
      const tempting = tryMove(TRAINING.fen, { ...parseUciFromSan(TRAINING.temptingMove) });
      if (!tempting) return;
      const engine = getEngine();
      const after = await engine.analyse(tempting.fen, { multiPv: 3 });
      const tactic = await findTacticalConsequence({
        engine,
        beforeFen: TRAINING.fen,
        learnerMove: tempting.move,
        baseline: base,
        after,
      });
      session.setTrap({
        san: tempting.move.san,
        text: tactic
          ? tacticExplanation(tactic)
          : `It looks natural, but Stockfish prefers ${best}.`,
      });
    } catch {
      /* the recap falls back to a generic line */
    }
  }

  function retry(revealBest: boolean) {
    setFen(TRAINING.fen);
    setLastMove(null);
    setResult(null);
    setShowBest(revealBest);
    if (revealBest) session.markRevealed();
    setPhase("ready");
  }

  const arrows: Arrow[] = [];
  if (phase === "wrong" && result) {
    // Prefer the verified tactical move; otherwise the engine's top reply.
    const punish = result.tactic ? parseUci(result.tactic.opponentMoveUci) : result.refutation;
    if (punish) arrows.push({ startSquare: punish.from, endSquare: punish.to, color: RED });
  }
  const tacticSquares =
    phase === "wrong" && result?.tactic ? result.tactic.targets.map((t) => t.square) : [];
  if (phase === "ready" && showBest && baseline) {
    const b = parseUci(baseline.bestMove);
    arrows.push({ startSquare: b.from, endSquare: b.to, color: GREEN });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,600px)_1fr] lg:gap-12 lg:py-12">
      <div className="mx-auto w-full max-w-[600px]">
        <ChessBoard
          fen={fen}
          orientation={TRAINING.playerColor}
          movableColor={phase === "ready" ? "b" : null}
          onMove={handleMove}
          lastMove={lastMove}
          focusSquares={phase === "ready" ? TRAINING.focusSquares : tacticSquares}
          arrows={arrows}
        />
        <p className="mt-3 font-mono text-[13px] text-muted">{TRAINING.setup}</p>
      </div>

      <div className="space-y-5">
        <div>
          <Eyebrow>Step 2 · Train</Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight">
            {TRAINING.title}
          </h1>
          <p className="mt-3 max-w-prose leading-relaxed text-muted">{TRAINING.prompt}</p>
        </div>

        {engineError && (
          <Panel tone="danger">
            <p className="font-semibold">The chess engine couldn&apos;t start.</p>
            <p className="mt-1 text-sm">Reload the page to try again.</p>
          </Panel>
        )}

        {!engineError && phase === "loading" && (
          <p className="text-sm text-muted">Preparing the engine…</p>
        )}

        {phase === "ready" && (
          <Panel>
            <p className="text-sm font-semibold">Your move as Black</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Play what you think is best — drag a piece, or click it and then a highlighted
              square. Stockfish will check your answer.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setShowHint(true)} disabled={showHint}>
                Show a hint
              </Button>
            </div>
            {showHint && (
              <p className="mt-3 rounded-lg bg-gold-soft px-3.5 py-2.5 text-sm">
                💡 {TRAINING.hint}
              </p>
            )}
            {showBest && bestSan && (
              <p className="mt-3 text-sm">
                The better move is <strong>{bestSan}</strong> (green arrow). Play it to continue.
              </p>
            )}
          </Panel>
        )}

        {phase === "checking" && (
          <Panel>
            <p className="text-sm font-semibold">Checking your move with Stockfish…</p>
          </Panel>
        )}

        {phase === "wrong" && result && (
          <Panel tone="danger">
            <div className="flex items-center gap-2">
              <Badge tone="danger">Inferior move</Badge>
              {result.tactic && <Badge tone="gold">{motifLabel(result.tactic)}</Badge>}
              <span className="text-xs text-muted">
                Not the end of the world — let&apos;s see why.
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MoveStat
                label="You played"
                san={result.playedSan}
                evalText={result.playedEval}
                tone="danger"
              />
              <MoveStat
                label="Better move"
                san={result.bestSan}
                evalText={result.bestEval}
                tone="good"
              />
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-danger">
                Why it&apos;s weaker
              </p>
              {result.explanation === null ? (
                <div
                  className="mt-2 space-y-2"
                  aria-busy="true"
                  aria-label="Coach is writing an explanation"
                >
                  <div className="h-3 w-full animate-pulse rounded bg-danger/15" />
                  <div className="h-3 w-11/12 animate-pulse rounded bg-danger/15" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-danger/15" />
                </div>
              ) : (
                <p className="mt-2 leading-relaxed">{result.explanation}</p>
              )}
              {result.tactic ? (
                <p className="mt-2 text-xs text-muted">
                  Tactic: {motifLabel(result.tactic)}, confirmed by Stockfish. The red arrow shows{" "}
                  {result.tactic.opponentMove}; outlined squares are the pieces involved.
                </p>
              ) : (
                result.refutation && (
                  <p className="mt-2 text-xs text-muted">
                    The red arrow shows Stockfish&apos;s strongest reply, {result.refutation.san}.
                  </p>
                )
              )}
            </div>

            {principleAppliesTo(result.tactic) && (
              <div className="mt-4">
                <PrincipleBox title={TRAINING.principle.title} body={TRAINING.principle.body} />
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => retry(false)}>Try again</Button>
              <Button variant="secondary" onClick={() => retry(true)}>
                Show me the better move
              </Button>
            </div>
          </Panel>
        )}

        {phase === "correct" && result && (
          <Panel tone="good">
            <div className="flex items-center gap-2">
              <Badge tone="good">{result.verdict === "best" ? "Best move" : "Good move"}</Badge>
              <span className="text-xs text-muted">
                {session.attempts.length === 1
                  ? "First try."
                  : `Found on attempt ${session.attempts.length}.`}
              </span>
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              {result.playedSan} deals with the threat.
            </h2>
            {result.verdict === "good" && (
              <p className="mt-2 text-sm leading-relaxed">
                Stockfish rates {result.playedSan} at {result.playedEval}, close to its top choice{" "}
                <strong>{result.bestSan}</strong> ({result.bestEval}). Both address the problem.
              </p>
            )}
            {result.insight && <p className="mt-3 leading-relaxed">{result.insight}</p>}
            <div className="mt-4">
              <PrincipleBox title={TRAINING.principle.title} body={TRAINING.principle.body} />
            </div>
            <div className="mt-5">
              <LinkButton href="/recap">See your recap →</LinkButton>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function MoveStat({
  label,
  san,
  evalText,
  tone,
}: {
  label: string;
  san: string;
  evalText: string;
  tone: "danger" | "good";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold">{san}</p>
      <p className={`text-sm font-medium ${tone === "danger" ? "text-danger" : "text-good"}`}>
        {evalText} <span className="font-normal text-muted">for you</span>
      </p>
    </div>
  );
}
