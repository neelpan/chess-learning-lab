"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { href: "/play", label: "Play" },
  { href: "/train", label: "Train" },
  { href: "/recap", label: "Recap" },
];

export function Header() {
  const pathname = usePathname();
  const current = STEPS.findIndex((s) => pathname.startsWith(s.href));

  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-accent text-base leading-none text-white"
          >
            ♞
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            Chess Learning Lab
          </span>
        </Link>

        <nav aria-label="Lesson steps" className="flex items-center gap-1 text-sm">
          {STEPS.map((step, i) => {
            const active = i === current;
            const done = current > i;
            return (
              <Link
                key={step.href}
                href={step.href}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-accent-soft hover:text-ink"
                }`}
              >
                <span
                  className={`grid size-5 place-items-center rounded-full text-[11px] font-semibold ${
                    active
                      ? "bg-white/20"
                      : done
                        ? "bg-accent text-white"
                        : "border border-line"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="hidden font-medium sm:inline">{step.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
