import { HeroBoard } from "@/components/HeroBoard";
import { Eyebrow, LinkButton } from "@/components/ui";

const LOOP = [
  {
    n: "1",
    title: "Play",
    body: "Start from a real opening position and make a move. The lab recognises the idea you've walked into and tells you why it matters.",
  },
  {
    n: "2",
    title: "Train",
    body: "Face a position where the natural move is a mistake. Stockfish judges your answer — no guessing, no vibes.",
  },
  {
    n: "3",
    title: "Recap",
    body: "See the concept, the mistake worth revisiting, the principle behind it, and one takeaway to carry into your next game.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-16">
        <div>
          <Eyebrow>A tighter learning loop</Eyebrow>
          <h1 className="mt-3 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Stop repeating the same chess mistakes.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Play a position, recognise the concept behind it, understand exactly why a move is
            weaker, and lock the principle in — in about five minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <LinkButton href="/play" className="!px-7 !py-3 !text-base">
              Start the lesson →
            </LinkButton>
            <span className="text-sm text-muted">No sign-up. Takes about 5 minutes.</span>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[460px]">
          <HeroBoard />
        </div>
      </div>

      <ol className="mt-16 grid gap-4 md:grid-cols-3">
        {LOOP.map((step) => (
          <li key={step.n} className="rounded-2xl border border-line bg-surface p-6">
            <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {step.n}
            </span>
            <h2 className="mt-4 font-display text-2xl font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
