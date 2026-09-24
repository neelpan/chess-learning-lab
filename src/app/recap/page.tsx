"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { Badge, Eyebrow, LinkButton, Panel, PrincipleBox } from "@/components/ui";
import { CONCEPTS, TRAINING } from "@/content/curriculum";
import { recapFallback, type RecapFacts } from "@/lib/teaching";

export default function RecapPage() {
  const { attempts, concepts, solved, usedReveal, trap, resetAll } = useSession();
  const completed = solved;

  const mistake = attempts.find((a) => a.verdict === "inferior") ?? null;
  const conceptList = useMemo(() => {
    const ids = Array.from(new Set([...concepts, ...TRAINING.concepts]));
    return ids.map((id) => CONCEPTS[id]).filter(Boolean);
  }, [concepts]);

  const facts = useMemo<RecapFacts>(
    () => ({
      concepts: conceptList.map((c) => c.name),
      principle: TRAINING.principle.title,
      mistake: mistake ? { playedSan: mistake.san, bestSan: mistake.bestSan } : null,
    }),
    [conceptList, mistake],
  );

  const [takeaway, setTakeaway] = useState<string | null>(null);
  useEffect(() => {
    if (!completed) return;
    let cancelled = false;
    fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "recap", facts }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && setTakeaway(d.text))
      .catch(() => !cancelled && setTakeaway(recapFallback()));
    return () => {
      cancelled = true;
    };
  }, [completed, facts]);

  if (!completed) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center">
        <Eyebrow>Step 3 · Recap</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          Nothing to recap yet
        </h1>
        <p className="mt-3 text-muted">
          Finish the training position and your personal recap will appear here.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <LinkButton href="/train">Go to training</LinkButton>
        </div>
      </div>
    );
  }

  const attemptsToSolve = attempts.length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 lg:py-14">
      <Eyebrow>Step 3 · Recap</Eyebrow>
      <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        What you learned
      </h1>
      <p className="mt-3 text-muted">
        {attemptsToSolve === 1
          ? "You found the right idea on your first try."
          : `You found the right idea on attempt ${attemptsToSolve}${usedReveal ? ", with a peek at the answer" : ""}.`}
      </p>

      {/* One-line takeaway */}
      <div className="rise mt-8 rounded-2xl bg-accent px-6 py-7 text-white sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Takeaway</p>
        {takeaway === null ? (
          <div className="mt-3 space-y-2" aria-busy="true" aria-label="Writing your takeaway">
            <div className="h-4 w-full animate-pulse rounded bg-white/20" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/20" />
          </div>
        ) : (
          <p className="mt-2 font-display text-2xl font-medium leading-snug sm:text-3xl">
            {takeaway}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Panel>
          <h2 className="font-display text-xl font-semibold">Concepts you encountered</h2>
          <ul className="mt-4 space-y-4">
            {conceptList.map((c) => (
              <li key={c.id}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <Badge>{c.kind}</Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{c.idea}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-5">
          {mistake ? (
            <Panel tone="danger">
              <h2 className="font-display text-xl font-semibold">Mistake worth revisiting</h2>
              <p className="mt-3 text-sm">
                You played <strong className="font-display text-lg">{mistake.san}</strong>{" "}
                <span className="text-danger">({mistake.playedEval})</span> instead of{" "}
                <strong className="font-display text-lg">{mistake.bestSan}</strong>{" "}
                <span className="text-good">({mistake.bestEval})</span>.
              </p>
              {mistake.explanation && (
                <p className="mt-2 text-sm leading-relaxed">{mistake.explanation}</p>
              )}
            </Panel>
          ) : (
            <Panel tone="gold">
              <h2 className="font-display text-xl font-semibold">A trap to keep in mind</h2>
              <p className="mt-2 text-sm leading-relaxed">
                No mistakes this time. But many players are tempted by{" "}
                <strong>{trap?.san ?? TRAINING.temptingMove}</strong> here.{" "}
                {trap?.text ?? "Stockfish prefers a different move."}
              </p>
            </Panel>
          )}

          <PrincipleBox title={TRAINING.principle.title} body={TRAINING.principle.body} />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href="/train">Practise it again</LinkButton>
        <LinkButton href="/play" variant="secondary" onClick={resetAll}>
          Start over from Play
        </LinkButton>
      </div>
    </div>
  );
}
