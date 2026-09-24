"use client";

import { useEffect, useState } from "react";
import type { Arrow } from "react-chessboard";
import { ChessBoard } from "@/components/ChessBoard";
import { useSession } from "@/components/SessionProvider";
import { Badge, Button, Eyebrow, LinkButton, Panel, PrincipleBox } from "@/components/ui";
import { formatEval, lineToSan, parseUci, tryMove, uciToSan, type Uci } from "@/lib/chess-utils";
import { getEngine, type Analysis } from "@/lib/engine";
import { mistakeFallback, type MistakeFacts } from "@/lib/teaching";
import { TRAINING } from "@/content/curriculum";

type Phase = "loading" | "ready" | "checking" | "wrong" | "correct";

type Result = {
  playedSan: string;
  bestSan: string;
  playedEval: string;
  bestEval: string;
  verdict: "best" | "good" | "inferior";
  refutation: { san: string; from: string; to: string } | null;
  explanation: string | null; // null while the coach is still writing
};

const RED = "rgba(169, 63, 44, 0.85)";
const GREEN = "rgba(44, 122, 75, 0.9)";

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
    if (!isBest) {
      try {
        const after = await getEngine().analyse(afterFen);
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
      session.markSolved();
      setResult({ ...summary, refutation: null, explanation: null });
      setPhase("correct");
      return;
    }

    setResult({ ...summary, refutation: reply, explanation: null });
    setPhase("wrong");

    // Natural-language explanation: LLM when configured, deterministic copy otherwise.
    const facts: MistakeFacts = {
      theme: TRAINING.theme,
      principle: TRAINING.principle.body,
      playerColor: "Black",
      playedSan,
      bestSan: best,
      playedEval,
      bestEval,
      refutationLine: lineToSan(afterFen, replyPv, 4),
      bestLine: lineToSan(TRAINING.fen, base.pv, 5),
    };
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

  function retry(revealBest: boolean) {
    setFen(TRAINING.fen);
    setLastMove(null);
    setResult(null);
    setShowBest(revealBest);
    if (revealBest) session.markRevealed();
    setPhase("ready");
  }

  const arrows: Arrow[] = [];
  if (phase === "wrong" && result?.refutation) {
    arrows.push({
      startSquare: result.refutation.from,
      endSquare: result.refutation.to,
      color: RED,
    });
  }
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
          focusSquares={phase === "ready" ? TRAINING.focusSquares : []}
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
              {result.refutation && (
                <p className="mt-2 text-sm text-muted">
                  Engine&apos;s punishing reply:{" "}
                  <strong className="text-ink">{result.refutation.san}</strong> (red arrow).
                </p>
              )}
            </div>

            <div className="mt-4">
              <PrincipleBox title={TRAINING.principle.title} body={TRAINING.principle.body} />
            </div>

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
            <p className="mt-3 leading-relaxed">{TRAINING.whyBestWorks}</p>
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
